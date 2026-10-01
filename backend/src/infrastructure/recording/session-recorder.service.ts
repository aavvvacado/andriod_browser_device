import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../../core/logger.js';

const execAsync = promisify(exec);

export interface SessionRecordingMetadata {
  sessionId: string;
  clientToken?: string;
  deviceSerial: string;
  deviceModel: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  rawFilePath: string;
  mp4FilePath?: string;
  fileSizeBytes?: number;
  status: 'recording' | 'completed' | 'failed';
  saved?: boolean;
}

export class SessionRecorder {
  private logger = new Logger('SessionRecorder');
  private recordingsDir: string;
  private writeStream: fs.WriteStream | null = null;
  private metadata: SessionRecordingMetadata;
  private isClosed = false;

  constructor(
    private sessionId: string,
    private deviceSerial: string,
    private deviceModel: string,
    private clientToken: string = '',
    baseDir: string = process.cwd()
  ) {
    this.recordingsDir = path.join(baseDir, 'recordings');
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }

    const rawFilePath = path.join(this.recordingsDir, `${sessionId}.h264`);
    this.writeStream = fs.createWriteStream(rawFilePath, { flags: 'a' });

    this.metadata = {
      sessionId,
      clientToken,
      deviceSerial,
      deviceModel,
      startTime: Date.now(),
      rawFilePath,
      status: 'recording',
      saved: false,
    };

    this.saveMetadata();
    this.logger.info(`Session recording started for ${sessionId} (client: ${clientToken || 'anonymous'}) -> ${rawFilePath}`);
  }

  writePacket(data: Uint8Array): void {
    if (this.isClosed || !this.writeStream) return;
    try {
      this.writeStream.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    } catch (err: any) {
      this.logger.warn(`Failed writing recording packet: ${err.message}`);
    }
  }

  async stop(): Promise<SessionRecordingMetadata> {
    if (this.isClosed) return this.metadata;
    this.isClosed = true;

    return new Promise((resolve) => {
      if (!this.writeStream) {
        this.finishStop().then(resolve);
        return;
      }

      this.writeStream.end(async () => {
        const result = await this.finishStop();
        resolve(result);
      });
    });
  }

  private async finishStop(): Promise<SessionRecordingMetadata> {
    this.metadata.endTime = Date.now();
    this.metadata.durationMs = this.metadata.endTime - this.metadata.startTime;

    const mp4FilePath = path.join(this.recordingsDir, `${this.sessionId}.mp4`);
    this.metadata.mp4FilePath = mp4FilePath;

    try {
      // Use FFmpeg to transwrap Annex B H.264 into an MP4 container
      this.logger.info(`Converting recording ${this.sessionId} to MP4 container...`);
      const cmd = `ffmpeg -y -hide_banner -loglevel error -framerate 60 -i "${this.metadata.rawFilePath}" -c:v copy -movflags +faststart "${mp4FilePath}"`;
      await execAsync(cmd);

      if (fs.existsSync(mp4FilePath)) {
        const stats = fs.statSync(mp4FilePath);
        this.metadata.fileSizeBytes = stats.size;
        this.metadata.status = 'completed';
        this.logger.info(`Session recording successfully converted to MP4 (${Math.round(stats.size / 1024)} KB)`);
      } else {
        throw new Error('MP4 file was not created');
      }
    } catch (err: any) {
      this.logger.error(`FFmpeg MP4 conversion failed for ${this.sessionId}:`, err.message);
      // Fallback: keep raw .h264
      if (fs.existsSync(this.metadata.rawFilePath)) {
        const stats = fs.statSync(this.metadata.rawFilePath);
        this.metadata.fileSizeBytes = stats.size;
      }
      this.metadata.status = 'completed';
    }

    this.saveMetadata();
    return this.metadata;
  }

  private saveMetadata(): void {
    try {
      const metaPath = path.join(this.recordingsDir, `${this.sessionId}.json`);
      fs.writeFileSync(metaPath, JSON.stringify(this.metadata, null, 2));
    } catch (err: any) {
      this.logger.warn(`Failed to save recording metadata: ${err.message}`);
    }
  }

  static getMetadata(sessionId: string, baseDir: string = process.cwd()): SessionRecordingMetadata | null {
    const metaPath = path.join(baseDir, 'recordings', `${sessionId}.json`);
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  static saveRecording(sessionId: string, baseDir: string = process.cwd()): SessionRecordingMetadata | null {
    const dir = path.join(baseDir, 'recordings');
    const metaPath = path.join(dir, `${sessionId}.json`);
    if (!fs.existsSync(metaPath)) return null;
    try {
      const meta: SessionRecordingMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.saved = true;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      const logger = new Logger('SessionRecorder');
      logger.info(`Marked session recording ${sessionId} as permanently SAVED`);
      return meta;
    } catch {
      return null;
    }
  }

  static deleteRecording(sessionId: string, baseDir: string = process.cwd()): boolean {
    const dir = path.join(baseDir, 'recordings');
    const logger = new Logger('SessionRecorder');
    let deletedAny = false;

    const filesToDelete = [
      path.join(dir, `${sessionId}.h264`),
      path.join(dir, `${sessionId}.mp4`),
      path.join(dir, `${sessionId}.json`),
    ];

    for (const f of filesToDelete) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
          deletedAny = true;
        } catch (err: any) {
          logger.warn(`Could not delete recording file ${f}: ${err.message}`);
        }
      }
    }

    if (deletedAny) {
      logger.info(`Deleted session recording files for ${sessionId} to reclaim disk space`);
    }
    return deletedAny;
  }

  static pruneUnsaved(maxAgeMs: number = 180000, baseDir: string = process.cwd()): number {
    const dir = path.join(baseDir, 'recordings');
    if (!fs.existsSync(dir)) return 0;

    const now = Date.now();
    let prunedCount = 0;
    const jsonFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

    for (const jf of jsonFiles) {
      const metaPath = path.join(dir, jf);
      try {
        const meta: SessionRecordingMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const age = now - (meta.startTime || 0);
        // If not explicitly saved and exceeds maxAgeMs, prune files
        if (meta.saved !== true && age > maxAgeMs) {
          SessionRecorder.deleteRecording(meta.sessionId, baseDir);
          prunedCount++;
        }
      } catch {
        // Corrupt JSON, delete it
        try { fs.unlinkSync(metaPath); } catch {}
      }
    }

    return prunedCount;
  }

  static listRecordings(baseDir: string = process.cwd(), onlySaved: boolean = false, clientToken?: string): SessionRecordingMetadata[] {
    const dir = path.join(baseDir, 'recordings');
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const list: SessionRecordingMetadata[] = [];

    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const meta: SessionRecordingMetadata = JSON.parse(content);
        if (onlySaved && meta.saved !== true) continue;

        // Machine / Client Isolation:
        // Ensure recordings on server are never visible to users on different machines
        if (clientToken && meta.clientToken && meta.clientToken !== clientToken) {
          continue;
        }

        list.push(meta);
      } catch (_) {}
    }

    return list.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  }
}
