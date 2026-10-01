const fs = require('fs');
const path = require('path');
const { AdbServerClient, Adb } = require('@yume-chan/adb');
const { AdbServerNodeTcpConnector } = require('@yume-chan/adb-server-node-tcp');
const { AdbScrcpyClient, AdbScrcpyOptions2_7 } = require('@yume-chan/adb-scrcpy');
const { BIN } = require('@yume-chan/scrcpy');

async function main() {
  console.log('Connecting to ADB server at 127.0.0.1:5037...');
  const connector = new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 });
  const client = new AdbServerClient(connector);
  const devices = await client.getDevices();
  if (devices.length === 0) {
    console.error('No ADB devices found!');
    process.exit(1);
  }
  const device = devices[0];
  console.log(`Using device: ${device.model} (${device.serial})`);
  const transport = await client.createTransport(device);
  const adb = new Adb(transport);

  // Read local scrcpy-server.jar that we downloaded
  const serverPath = path.resolve(__dirname, '..', 'scrcpy-server.jar');
  const serverBuffer = fs.readFileSync(serverPath);

  // Wrap buffer into a ReadableStream
  const fileStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(serverBuffer));
      controller.close();
    }
  });

  console.log('Pushing scrcpy-server.jar to device...');
  await AdbScrcpyClient.pushServer(
    adb,
    fileStream,
    '/data/local/tmp/scrcpy-server.jar'
  );

  console.log('Starting scrcpy session with AdbScrcpyOptions2_7...');
  const options = new AdbScrcpyOptions2_7({
    maxSize: 1080,
    videoBitRate: 4_000_000,
    tunnelForward: true, // Use forward connection
    audio: false,        // Focus on video for minimal spike
  });

  const scrcpy = await AdbScrcpyClient.start(
    adb,
    '/data/local/tmp/scrcpy-server.jar',
    options
  );

  console.log('Scrcpy session started successfully!');
  console.log('Video stream available:', !!scrcpy.videoStream);
  console.log('Controller available:', !!scrcpy.controller);

  if (scrcpy.controller) {
    console.log('Controller methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(scrcpy.controller)));
  }

  const videoStream = await scrcpy.videoStream;
  const { metadata, stream } = videoStream;
  console.log('Video metadata:', metadata);

  let packetCount = 0;
  let totalBytes = 0;
  const reader = stream.getReader();

  console.log('Reading first 5 video packets from device...');
  while (packetCount < 5) {
    const { done, value } = await reader.read();
    if (done) break;
    packetCount++;
    console.log(`Packet #${packetCount}:`, {
      type: value.type,
      keyframe: value.keyframe,
      pts: value.pts,
      dataLength: value.data?.byteLength
    });
  }

  console.log(`Successfully received ${packetCount} video packets (${totalBytes} bytes)!`);
  console.log('Closing scrcpy session...');
  await scrcpy.close();
  console.log('Spike completed cleanly!');
  process.exit(0);
}

main().catch(err => {
  console.error('Spike error:', err);
  process.exit(1);
});
