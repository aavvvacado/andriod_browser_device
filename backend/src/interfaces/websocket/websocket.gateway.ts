import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { SessionManagerService } from '../../application/services/session-manager.service.js';
import { ClientInputEvent } from '../../domain/entities/input-event.js';
import { Logger } from '../../core/logger.js';

export class WebSocketGateway {
  private logger = new Logger('WebSocketGateway');
  private wss: WebSocketServer;

  constructor(
    httpServer: HttpServer,
    private sessionManager: SessionManagerService
  ) {
    this.wss = new WebSocketServer({ server: httpServer });
    this.setupListeners();
  }

  private setupListeners(): void {
    this.wss.on('connection', async (ws: WebSocket, req) => {
      const clientId = randomUUID();
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const clientToken = url.searchParams.get('clientToken') || (req.headers['x-client-token'] as string) || '';
      const ip = req.socket.remoteAddress;
      this.logger.info(`New WebSocket client connected: ${clientId} (token: ${clientToken || 'none'}) from ${ip}`);

      try {
        await this.sessionManager.handleClientConnected(clientId, ws, clientToken);

        ws.on('message', async (data: Buffer | string) => {
          try {
            const raw = data.toString();
            const event = JSON.parse(raw) as ClientInputEvent;
            if (event.type !== 'ping') {
              this.logger.info(`Received event from ${clientId}: ${raw}`);
            }
            await this.sessionManager.handleClientInput(clientId, event);
          } catch (err: any) {
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

      } catch (err: any) {
        this.logger.error(`Failed to initialize session for client ${clientId}:`, err?.message || err);
        const isCapacity = err?.message && (err.message.includes('capacity') || err.message.includes('leased') || err.message.includes('No Android devices'));
        
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              code: isCapacity ? 'POOL_EXHAUSTED' : 'INITIALIZATION_FAILED',
              message: isCapacity
                ? 'All Android devices in the pool are currently occupied by active sessions. Please wait a moment for a device to be released and try again.'
                : (err?.message || 'Failed to initialize device session'),
            }));
          }
        } catch (_) {}

        setTimeout(() => {
          try {
            ws.close(1008, isCapacity ? 'Device pool occupied' : 'Init failed');
          } catch (_) {}
        }, 150);
      }
    });
  }
}
