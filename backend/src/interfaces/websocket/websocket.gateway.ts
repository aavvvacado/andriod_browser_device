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

        ws.on('close', () => {
          this.logger.info(`WebSocket client ${clientId} disconnected`);
          this.sessionManager.handleClientDisconnected(clientId);
        });

        ws.on('error', (err) => {
          this.logger.error(`WebSocket error for client ${clientId}:`, err);
        });

      } catch (err: any) {
        this.logger.error(`Failed to initialize session for client ${clientId}:`, err);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        ws.close();
      }
    });
  }
}
