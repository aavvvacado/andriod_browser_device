import { WebSocket } from 'ws';
import { IStreamBroadcaster } from '../../domain/repositories/broadcaster.interface.js';
import { Logger } from '../../core/logger.js';

export class WebSocketStreamBroadcaster implements IStreamBroadcaster {
  private logger = new Logger('WebSocketStreamBroadcaster');
  private clients: Map<string, WebSocket> = new Map();
  private latestConfigMessage: string | null = null;
  private latestKeyframeBuffer: Buffer | null = null;

  registerClient(clientId: string, socket: WebSocket): void {
    this.clients.set(clientId, socket);
    this.logger.debug(`Client ${clientId} registered. Total clients: ${this.clients.size}`);

    // If config message is available, send immediately to this new client
    if (this.latestConfigMessage && socket.readyState === WebSocket.OPEN) {
      socket.send(this.latestConfigMessage);
    }

    // If keyframe buffer is available, send immediately so client renders the screen instantly
    if (this.latestKeyframeBuffer && socket.readyState === WebSocket.OPEN) {
      socket.send(this.latestKeyframeBuffer);
    }
  }

  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
    this.logger.debug(`Client ${clientId} unregistered. Remaining clients: ${this.clients.size}`);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  broadcastConfig(codec: string, rawConfigBase64: string): void {
    const payload = JSON.stringify({
      type: 'config',
      codec,
      rawConfig: rawConfigBase64,
    });
    this.latestConfigMessage = payload;

    for (const [, ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  broadcastVideoFrame(isKeyframe: boolean, pts: bigint, data: Uint8Array): void {
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

    if (this.clients.size === 0) return;

    for (const [, ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
      }
    }
  }

  sendTo(clientId: string, data: string | Buffer): void {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
