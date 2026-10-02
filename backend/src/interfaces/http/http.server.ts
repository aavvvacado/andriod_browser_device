import http from 'http';
import fs from 'fs';
import path from 'path';
import { SessionManagerService } from '../../application/services/session-manager.service.js';
import { IDevicePoolRepository } from '../../domain/repositories/device-pool.repository.js';
import { Logger } from '../../core/logger.js';

export function createHttpServer(
  sessionManager: SessionManagerService,
  devicePool: IDevicePoolRepository
): http.Server {
  const logger = new Logger('HttpServer');
  const publicDir = path.resolve(process.cwd(), 'public');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // CORS headers for local APIs
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (pathname === '/health' || pathname === '/api/health') {
      const activeSessions = sessionManager.getActiveSessions();
      const availableDevices = await devicePool.getAvailableDevices();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'UP',
        timestamp: new Date().toISOString(),
        activeSessions: activeSessions.map(s => ({
          id: s.id,
          deviceModel: s.deviceModel,
          deviceSerial: s.deviceSerial,
          resolution: s.resolution,
          uptimeSeconds: Math.round((Date.now() - s.createdAt) / 1000),
        })),
        devicePool: {
          totalDevicesDetected: availableDevices.length,
          activeLeaseCount: devicePool.getActiveLeaseCount(),
          devices: availableDevices,
        }
      }, null, 2));
      return;
    }

    // Static file serving
    let safePath = path.normalize(pathname === '/' ? '/index.html' : pathname);
    let filePath = path.join(publicDir, safePath);

    // Fallback if requested path doesn't exist
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(publicDir, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.wasm': 'application/wasm',
    };

    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  return server;
}
