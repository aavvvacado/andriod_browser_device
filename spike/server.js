const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { AdbServerClient, Adb } = require('@yume-chan/adb');
const { AdbServerNodeTcpConnector } = require('@yume-chan/adb-server-node-tcp');
const { AdbScrcpyClient, AdbScrcpyOptions2_7 } = require('@yume-chan/adb-scrcpy');
const { AndroidMotionEventAction, AndroidKeyCode, h264ParseConfiguration } = require('@yume-chan/scrcpy');

const PORT = 3000;
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath);
  const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/plain';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocketServer({ server });

let activeScrcpy = null;
let activeDevice = null;
let deviceMetadata = null;
let latestConfigJson = null;
const clients = new Set();
let broadcastLoopRunning = false;

async function initScrcpy() {
  if (activeScrcpy) return activeScrcpy;

  console.log('Connecting to ADB server (127.0.0.1:5037)...');
  const connector = new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 });
  const client = new AdbServerClient(connector);
  const devices = await client.getDevices();
  if (devices.length === 0) {
    throw new Error('No ADB devices connected');
  }

  activeDevice = devices[0];
  console.log(`Using device: ${activeDevice.model} (${activeDevice.serial})`);
  const transport = await client.createTransport(activeDevice);
  const adb = new Adb(transport);

  const serverPath = path.resolve(__dirname, '..', 'scrcpy-server.jar');
  const serverBuffer = fs.readFileSync(serverPath);
  const fileStream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(serverBuffer));
      c.close();
    }
  });

  await AdbScrcpyClient.pushServer(adb, fileStream, '/data/local/tmp/scrcpy-server.jar');

  const options = new AdbScrcpyOptions2_7({
    maxSize: 1080,
    videoBitRate: 4_000_000,
    tunnelForward: true,
    audio: false,
    control: true,
  });

  console.log('Starting scrcpy-server...');
  activeScrcpy = await AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', options);
  const videoStream = await activeScrcpy.videoStream;
  deviceMetadata = videoStream.metadata;
  console.log('Scrcpy running! Metadata:', deviceMetadata);

  startBroadcastLoop(videoStream.stream);

  return activeScrcpy;
}

async function startBroadcastLoop(stream) {
  if (broadcastLoopRunning) return;
  broadcastLoopRunning = true;

  const reader = stream.getReader();
  console.log('Central video broadcast loop started.');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.type === 'configuration') {
        let codec = 'avc1.42001f';
        try {
          const parsed = h264ParseConfiguration(value.data);
          codec = 'avc1.' + [parsed.profileIndex, parsed.constraintSet, parsed.levelIndex]
            .map(x => x.toString(16).padStart(2, '0')).join('');
        } catch (e) {
          console.warn('Config parse fallback:', e.message);
        }

        const configMsg = JSON.stringify({
          type: 'config',
          codec,
          rawConfig: Buffer.from(value.data).toString('base64'),
        });

        latestConfigJson = configMsg;

        for (const ws of clients) {
          if (ws.readyState === ws.OPEN) {
            ws.send(configMsg);
          }
        }
      } else if (value.type === 'data') {
        const dataBuf = Buffer.from(value.data);
        const msg = Buffer.alloc(1 + 1 + 8 + dataBuf.length);
        msg[0] = 0x02; // type 2 = data frame
        msg[1] = value.keyframe ? 1 : 0;
        const pts = value.pts !== undefined ? BigInt(value.pts) : 0n;
        msg.writeBigInt64BE(pts, 2);
        dataBuf.copy(msg, 10);

        for (const ws of clients) {
          if (ws.readyState === ws.OPEN) {
            ws.send(msg);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error in broadcast loop:', err.message);
  } finally {
    broadcastLoopRunning = false;
    reader.releaseLock();
    console.log('Broadcast loop exited.');
  }
}

wss.on('connection', async (ws) => {
  console.log('Browser client connected to WebSocket.');
  clients.add(ws);

  try {
    if (!activeScrcpy) {
      await initScrcpy();
    }

    // Send init packet with device dimensions
    ws.send(JSON.stringify({
      type: 'init',
      width: deviceMetadata.width,
      height: deviceMetadata.height,
      model: activeDevice?.model || 'Android Device',
    }));

    // If we have cached config, send immediately
    if (latestConfigJson && ws.readyState === ws.OPEN) {
      ws.send(latestConfigJson);
    }

    // Handle incoming client messages (Input & Latency Ping)
    ws.on('message', async (data) => {
      try {
        const text = data.toString();
        const msg = JSON.parse(text);

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() }));
          return;
        }

        if (!activeScrcpy?.controller) return;

        if (msg.type === 'touch') {
          let action;
          if (msg.action === 'down') action = AndroidMotionEventAction.Down;
          else if (msg.action === 'move') action = AndroidMotionEventAction.Move;
          else if (msg.action === 'up') action = AndroidMotionEventAction.Up;

          if (action !== undefined) {
            await activeScrcpy.controller.injectTouch({
              action,
              pointerId: 0n,
              position: {
                x: Math.round(msg.x),
                y: Math.round(msg.y),
              },
              pressure: msg.action === 'up' ? 0.0 : 1.0,
              actionButton: 0,
              buttons: 0,
            });
          }
        } else if (msg.type === 'key') {
          let keyCode;
          if (msg.key === 'Home') keyCode = AndroidKeyCode.Home;
          else if (msg.key === 'Back') keyCode = AndroidKeyCode.Back;
          else if (msg.key === 'AppSwitch' || msg.key === 'Recents') keyCode = AndroidKeyCode.AppSwitch;
          else if (msg.key === 'Power') keyCode = AndroidKeyCode.Power;
          else if (msg.key === 'VolumeUp') keyCode = AndroidKeyCode.VolumeUp;
          else if (msg.key === 'VolumeDown') keyCode = AndroidKeyCode.VolumeDown;

          if (keyCode) {
            await activeScrcpy.controller.injectKeyCode({
              keyCode,
              action: 0, // Down
            });
            await activeScrcpy.controller.injectKeyCode({
              keyCode,
              action: 1, // Up
            });
          }
        } else if (msg.type === 'text') {
          if (msg.text) {
            await activeScrcpy.controller.injectText(msg.text);
          }
        }
      } catch (err) {
        console.error('Error handling message from client:', err.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('Browser client disconnected. Remaining clients:', clients.size);
    });

  } catch (err) {
    console.error('WebSocket connection error:', err);
    clients.delete(ws);
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`Spike Server running at: http://localhost:${PORT}`);
  console.log(`WebSocket endpoint at: ws://localhost:${PORT}`);
  console.log(`=======================================================`);
});

process.on('SIGINT', async () => {
  console.log('\nCleaning up scrcpy session...');
  if (activeScrcpy) {
    await activeScrcpy.close();
  }
  process.exit(0);
});
