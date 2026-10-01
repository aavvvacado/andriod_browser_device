"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketStreamBroadcaster = void 0;
const ws_1 = require("ws");
const logger_js_1 = require("../../core/logger.js");
class WebSocketStreamBroadcaster {
    logger = new logger_js_1.Logger('WebSocketStreamBroadcaster');
    clients = new Map();
    latestConfigMessage = null;
    latestKeyframeBuffer = null;
    registerClient(clientId, socket) {
        this.clients.set(clientId, socket);
        this.logger.debug(`Client ${clientId} registered. Total clients: ${this.clients.size}`);
        // If config message is available, send immediately to this new client
        if (this.latestConfigMessage && socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(this.latestConfigMessage);
        }
        // If keyframe buffer is available, send immediately so client renders the screen instantly
        if (this.latestKeyframeBuffer && socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(this.latestKeyframeBuffer);
        }
    }
    unregisterClient(clientId) {
        this.clients.delete(clientId);
        this.logger.debug(`Client ${clientId} unregistered. Remaining clients: ${this.clients.size}`);
    }
    getClientCount() {
        return this.clients.size;
    }
    broadcastConfig(codec, rawConfigBase64) {
        const payload = JSON.stringify({
            type: 'config',
            codec,
            rawConfig: rawConfigBase64,
        });
        this.latestConfigMessage = payload;
        for (const [, ws] of this.clients) {
            if (ws.readyState === ws_1.WebSocket.OPEN) {
                ws.send(payload);
            }
        }
    }
    broadcastVideoFrame(isKeyframe, pts, data) {
        // Binary packet layout:
        // [0]: 0x02 (video data)
        // [1]: isKeyframe (1/0)
        // [2..9]: 8-byte PTS (BigInt64BE)
        // [10..]: NAL units
        const buffer = Buffer.alloc(1 + 1 + 8 + data.length);
        buffer[0] = 0x02;
        buffer[1] = isKeyframe ? 1 : 0;
        buffer.writeBigInt64BE(pts, 2);
        Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(buffer, 10);
        if (isKeyframe) {
            this.latestKeyframeBuffer = buffer;
        }
        if (this.clients.size === 0)
            return;
        for (const [, ws] of this.clients) {
            if (ws.readyState === ws_1.WebSocket.OPEN) {
                ws.send(buffer);
            }
        }
    }
    sendTo(clientId, data) {
        const ws = this.clients.get(clientId);
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(data);
        }
    }
}
exports.WebSocketStreamBroadcaster = WebSocketStreamBroadcaster;
