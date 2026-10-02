"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketGateway = void 0;
const ws_1 = require("ws");
const crypto_1 = require("crypto");
const logger_js_1 = require("../../core/logger.js");
class WebSocketGateway {
    sessionManager;
    logger = new logger_js_1.Logger('WebSocketGateway');
    wss;
    constructor(httpServer, sessionManager) {
        this.sessionManager = sessionManager;
        this.wss = new ws_1.WebSocketServer({ server: httpServer });
        this.setupListeners();
    }
    setupListeners() {
        this.wss.on('connection', async (ws, req) => {
            const clientId = (0, crypto_1.randomUUID)();
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const clientToken = url.searchParams.get('clientToken') || req.headers['x-client-token'] || '';
            const ip = req.socket.remoteAddress;
            this.logger.info(`New WebSocket client connected: ${clientId} (token: ${clientToken || 'none'}) from ${ip}`);
            try {
                await this.sessionManager.handleClientConnected(clientId, ws, clientToken);
                ws.on('message', async (data) => {
                    try {
                        const raw = data.toString();
                        const event = JSON.parse(raw);
                        if (event.type !== 'ping') {
                            this.logger.info(`Received event from ${clientId}: ${raw}`);
                        }
                        await this.sessionManager.handleClientInput(clientId, event);
                    }
                    catch (err) {
                        this.logger.error(`Failed parsing client ${clientId} message:`, err.message);
                    }
                });
                ws.on('close', (code, reason) => {
                    this.logger.info(`WebSocket client ${clientId} disconnected (code: ${code}, reason: ${reason?.toString() || 'none'})`);
                    this.sessionManager.handleClientDisconnected(clientId);
                });
                ws.on('error', (err) => {
                    this.logger.error(`WebSocket socket error for client ${clientId}:`, err?.message || err);
                    this.sessionManager.handleClientDisconnected(clientId);
                });
            }
            catch (err) {
                this.logger.error(`Failed to initialize session for client ${clientId}:`, err?.message || err);
                const isCapacity = err?.message && (err.message.includes('capacity') || err.message.includes('leased') || err.message.includes('No Android devices'));
                try {
                    if (ws.readyState === ws_1.WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: isCapacity ? 'POOL_EXHAUSTED' : 'INITIALIZATION_FAILED',
                            message: isCapacity
                                ? 'All Android devices in the pool are currently occupied by active sessions. Please wait a moment for a device to be released and try again.'
                                : (err?.message || 'Failed to initialize device session'),
                        }));
                    }
                }
                catch (_) { }
                setTimeout(() => {
                    try {
                        ws.close(1008, isCapacity ? 'Device pool occupied' : 'Init failed');
                    }
                    catch (_) { }
                }, 150);
            }
        });
    }
}
exports.WebSocketGateway = WebSocketGateway;
