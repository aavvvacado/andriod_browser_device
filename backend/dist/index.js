"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_js_1 = require("./core/config.js");
const logger_js_1 = require("./core/logger.js");
const adb_device_pool_adapter_js_1 = require("./infrastructure/adb/adb-device-pool.adapter.js");
const scrcpy_manager_adapter_js_1 = require("./infrastructure/scrcpy/scrcpy-manager.adapter.js");
const session_manager_service_js_1 = require("./application/services/session-manager.service.js");
const http_server_js_1 = require("./interfaces/http/http.server.js");
const websocket_gateway_js_1 = require("./interfaces/websocket/websocket.gateway.js");
const logger = new logger_js_1.Logger('AppBootstrap');
async function bootstrap() {
    logger.info('Initializing Real-Time Android Browser Streaming Backend...');
    logger.info(`Configuration: Port=${config_js_1.config.port}, ADB=${config_js_1.config.adbHost}:${config_js_1.config.adbPort}, MaxSessions=${config_js_1.config.maxSessions}`);
    // 1. Infrastructure layer
    const adbDevicePool = new adb_device_pool_adapter_js_1.AdbDevicePoolAdapter();
    const scrcpyManager = new scrcpy_manager_adapter_js_1.ScrcpyManagerAdapter(adbDevicePool);
    // 2. Application layer
    const sessionManager = new session_manager_service_js_1.SessionManagerService(adbDevicePool, scrcpyManager);
    // 3. Interface layer
    const httpServer = (0, http_server_js_1.createHttpServer)(sessionManager, adbDevicePool);
    new websocket_gateway_js_1.WebSocketGateway(httpServer, sessionManager);
    // 4. Start HTTP & WebSocket server
    httpServer.listen(config_js_1.config.port, () => {
        logger.info(`=======================================================`);
        logger.info(`Backend Service listening on http://localhost:${config_js_1.config.port}`);
        logger.info(`Health Endpoint: http://localhost:${config_js_1.config.port}/health`);
        logger.info(`Recordings Endpoint: http://localhost:${config_js_1.config.port}/api/recordings`);
        logger.info(`WebSocket Gateway: ws://localhost:${config_js_1.config.port}`);
        logger.info(`=======================================================`);
    });
    // 5. Graceful shutdown handler
    const shutdown = async (signal) => {
        logger.info(`Received ${signal}. Initiating graceful termination...`);
        httpServer.close();
        await sessionManager.terminateAll();
        logger.info('Graceful shutdown completed.');
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled Rejection detected (prevented crash):', reason?.message || reason);
    });
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught Exception detected (prevented crash):', err?.message || err);
    });
}
bootstrap().catch((err) => {
    logger.error('Fatal bootstrap error:', err);
    process.exit(1);
});
