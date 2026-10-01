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
                ws.on('close', () => {
                    this.logger.info(`WebSocket client ${clientId} disconnected`);
                    this.sessionManager.handleClientDisconnected(clientId);
                });
                ws.on('error', (err) => {
                    this.logger.error(`WebSocket error for client ${clientId}:`, err);
                });
            }
            catch (err) {
                this.logger.error(`Failed to initialize session for client ${clientId}:`, err);
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
                ws.close();
            }
        });
    }
}
exports.WebSocketGateway = WebSocketGateway;
