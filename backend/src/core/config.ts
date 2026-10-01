import path from 'path';

export interface AppConfig {
  port: number;
  adbHost: string;
  adbPort: number;
  scrcpyServerPath: string;
  maxSessions: number;
  idleTimeoutMs: number;
  maxVideoBitrate: number;
  maxVideoSize: number;
}

export const config: AppConfig = {
  port: Number(process.env.PORT) || 3000,
  adbHost: process.env.ADB_HOST || '127.0.0.1',
  adbPort: Number(process.env.ADB_PORT) || 5037,
  scrcpyServerPath: process.env.SCRCPY_SERVER_PATH || path.resolve(process.cwd(), '..', 'scrcpy-server.jar'),
  maxSessions: Number(process.env.MAX_SESSIONS) || 3,
  idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MS) || 180000, // 3 minutes
  maxVideoBitrate: Number(process.env.MAX_VIDEO_BITRATE) || 4_000_000, // 4 Mbps
  maxVideoSize: Number(process.env.MAX_VIDEO_SIZE) || 1080,
};
