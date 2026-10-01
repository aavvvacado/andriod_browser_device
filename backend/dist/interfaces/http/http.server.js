"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpServer = createHttpServer;
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const session_recorder_service_js_1 = require("../../infrastructure/recording/session-recorder.service.js");
const logger_js_1 = require("../../core/logger.js");
function createHttpServer(sessionManager, devicePool) {
    const logger = new logger_js_1.Logger('HttpServer');
    const publicDir = path_1.default.resolve(process.cwd(), 'public');
    const recordingsDir = path_1.default.resolve(process.cwd(), 'recordings');
    const server = http_1.default.createServer(async (req, res) => {
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
        // Bonus 5: List all recorded sessions
        if (pathname === '/api/recordings' && req.method === 'GET') {
            const recordings = session_recorder_service_js_1.SessionRecorder.listRecordings();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(recordings, null, 2));
            return;
        }
        // Bonus 5: Download or stream specific session recording (MP4 with Range support)
        if (pathname.startsWith('/api/recordings/') && req.method === 'GET') {
            const targetId = pathname.replace('/api/recordings/', '').trim();
            let targetFile = path_1.default.join(recordingsDir, `${targetId}.mp4`);
            let contentType = 'video/mp4';
            if (!fs_1.default.existsSync(targetFile)) {
                targetFile = path_1.default.join(recordingsDir, `${targetId}.h264`);
                contentType = 'application/octet-stream';
            }
            if (!fs_1.default.existsSync(targetFile)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Recording not found' }));
                return;
            }
            const stat = fs_1.default.statSync(targetFile);
            const fileSize = stat.size;
            const range = req.headers.range;
            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs_1.default.createReadStream(targetFile, { start, end });
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': contentType,
                });
                file.pipe(res);
            }
            else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                    'Content-Disposition': `attachment; filename="${path_1.default.basename(targetFile)}"`,
                });
                fs_1.default.createReadStream(targetFile).pipe(res);
            }
            return;
        }
        // Static file serving
        let safePath = path_1.default.normalize(pathname === '/' ? '/index.html' : pathname);
        let filePath = path_1.default.join(publicDir, safePath);
        // Fallback if requested path doesn't exist
        if (!fs_1.default.existsSync(filePath) || fs_1.default.statSync(filePath).isDirectory()) {
            filePath = path_1.default.join(publicDir, 'index.html');
        }
        if (!fs_1.default.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        const ext = path_1.default.extname(filePath);
        const mimeTypes = {
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
        fs_1.default.createReadStream(filePath).pipe(res);
    });
    return server;
}
