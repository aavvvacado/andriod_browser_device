const fs = require('fs');
const path = require('path');
const { AdbServerClient, Adb } = require('@yume-chan/adb');
const { AdbServerNodeTcpConnector } = require('@yume-chan/adb-server-node-tcp');
const { AdbScrcpyClient, AdbScrcpyOptions2_7 } = require('@yume-chan/adb-scrcpy');
const { AndroidMotionEventAction } = require('@yume-chan/scrcpy');

async function main() {
  const connector = new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 });
  const client = new AdbServerClient(connector);
  const devices = await client.getDevices();
  const device = devices[0];
  console.log(`Connecting to ${device.model}...`);
  const transport = await client.createTransport(device);
  const adb = new Adb(transport);

  const serverPath = path.resolve(__dirname, '..', 'scrcpy-server.jar');
  const serverBuffer = fs.readFileSync(serverPath);
  const fileStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(serverBuffer));
      controller.close();
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

  const scrcpy = await AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', options);
  console.log('Scrcpy started. Width:', (await scrcpy.videoStream).metadata.width, 'Height:', (await scrcpy.videoStream).metadata.height);

  console.log('Injecting touch down...');
  await scrcpy.controller.injectTouch({
    action: AndroidMotionEventAction.Down,
    pointerId: 0n,
    position: { x: 244, y: 500 },
    pressure: 1.0,
    actionButton: 0,
    buttons: 0,
  });

  await new Promise(r => setTimeout(r, 100));

  console.log('Injecting touch up...');
  await scrcpy.controller.injectTouch({
    action: AndroidMotionEventAction.Up,
    pointerId: 0n,
    position: { x: 244, y: 500 },
    pressure: 0.0,
    actionButton: 0,
    buttons: 0,
  });

  console.log('Touch injected successfully!');
  await scrcpy.close();
}

main().catch(console.error);
