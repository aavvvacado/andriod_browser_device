import { config } from './core/config.js';
import { Logger } from './core/logger.js';
import { AdbDevicePoolAdapter } from './infrastructure/adb/adb-device-pool.adapter.js';
import { ScrcpyManagerAdapter } from './infrastructure/scrcpy/scrcpy-manager.adapter.js';
import { WebSocketStreamBroadcaster } from './infrastructure/websocket/websocket-broadcaster.adapter.js';
import { SessionManagerService } from './application/services/session-manager.service.js';
import { createHttpServer } from './interfaces/http/http.server.js';
import { WebSocketGateway } from './interfaces/websocket/websocket.gateway.js';
import { SessionRecorder } from './infrastructure/recording/session-recorder.service.js';

const logger = new Logger('AppBootstrap');

async function bootstrap() {
  logger.info('Initializing Real-Time Android Browser Streaming Backend...');
  logger.info(`Configuration: Port=${config.port}, ADB=${config.adbHost}:${config.adbPort}, MaxSessions=${config.maxSessions}`);

  // 1. Infrastructure layer
  const adbDevicePool = new AdbDevicePoolAdapter();
  const scrcpyManager = new ScrcpyManagerAdapter(adbDevicePool);

  // 2. Application layer
  const sessionManager = new SessionManagerService(
    adbDevicePool,
    scrcpyManager
  );

  // 3. Interface layer
  const httpServer = createHttpServer(sessionManager, adbDevicePool);
  new WebSocketGateway(httpServer, sessionManager);

  // 4. Start HTTP & WebSocket server
  httpServer.listen(config.port, () => {
    logger.info(`=======================================================`);
    logger.info(`Backend Service listening on http://localhost:${config.port}`);
    logger.info(`Health Endpoint: http://localhost:${config.port}/health`);
    logger.info(`Recordings Endpoint: http://localhost:${config.port}/api/recordings`);
    logger.info(`WebSocket Gateway: ws://localhost:${config.port}`);
    logger.info(`=======================================================`);
  });

  // 4b. Background disk space protector: prune unsaved/abandoned recordings
  SessionRecorder.pruneUnsaved();
  const prunerInterval = setInterval(() => {
    SessionRecorder.pruneUnsaved();
  }, 120000);

  // 5. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful termination...`);
    clearInterval(prunerInterval);
    httpServer.close();
    await sessionManager.terminateAll();
    logger.info('Graceful shutdown completed.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled Rejection detected (prevented crash):', reason?.message || reason);
  });

  process.on('uncaughtException', (err: any) => {
    logger.error('Uncaught Exception detected (prevented crash):', err?.message || err);
  });
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error:', err);
  process.exit(1);
});
