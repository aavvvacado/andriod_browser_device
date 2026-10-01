"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionRecorder = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const logger_js_1 = require("../../core/logger.js");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class SessionRecorder {
    sessionId;
    deviceSerial;
    deviceModel;
    logger = new logger_js_1.Logger('SessionRecorder');
    recordingsDir;
    writeStream = null;
    metadata;
    isClosed = false;
    constructor(sessionId, deviceSerial, deviceModel, baseDir = process.cwd()) {
        this.sessionId = sessionId;
        this.deviceSerial = deviceSerial;
        this.deviceModel = deviceModel;
        this.recordingsDir = path_1.default.join(baseDir, 'recordings');
        if (!fs_1.default.existsSync(this.recordingsDir)) {
            fs_1.default.mkdirSync(this.recordingsDir, { recursive: true });
        }
        const rawFilePath = path_1.default.join(this.recordingsDir, `${sessionId}.h264`);
        this.writeStream = fs_1.default.createWriteStream(rawFilePath, { flags: 'a' });
        this.metadata = {
            sessionId,
            deviceSerial,
            deviceModel,
            startTime: Date.now(),
            rawFilePath,
            status: 'recording',
        };
        this.saveMetadata();
        this.logger.info(`Session recording started for ${sessionId} -> ${rawFilePath}`);
    }
    writePacket(data) {
        if (this.isClosed || !this.writeStream)
            return;
        try {
            this.writeStream.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
        }
        catch (err) {
            this.logger.warn(`Failed writing recording packet: ${err.message}`);
        }
    }
    async stop() {
        if (this.isClosed)
            return this.metadata;
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
    async finishStop() {
        this.metadata.endTime = Date.now();
        this.metadata.durationMs = this.metadata.endTime - this.metadata.startTime;
        const mp4FilePath = path_1.default.join(this.recordingsDir, `${this.sessionId}.mp4`);
        this.metadata.mp4FilePath = mp4FilePath;
        try {
            // Use FFmpeg to transwrap Annex B H.264 into an MP4 container
            this.logger.info(`Converting recording ${this.sessionId} to MP4 container...`);
            const cmd = `ffmpeg -y -hide_banner -loglevel error -framerate 60 -i "${this.metadata.rawFilePath}" -c:v copy -movflags +faststart "${mp4FilePath}"`;
            await execAsync(cmd);
            if (fs_1.default.existsSync(mp4FilePath)) {
                const stats = fs_1.default.statSync(mp4FilePath);
                this.metadata.fileSizeBytes = stats.size;
                this.metadata.status = 'completed';
                this.logger.info(`Session recording successfully converted to MP4 (${Math.round(stats.size / 1024)} KB)`);
            }
            else {
                throw new Error('MP4 file was not created');
            }
        }
        catch (err) {
            this.logger.error(`FFmpeg MP4 conversion failed for ${this.sessionId}:`, err.message);
            // Fallback: keep raw .h264
            if (fs_1.default.existsSync(this.metadata.rawFilePath)) {
                const stats = fs_1.default.statSync(this.metadata.rawFilePath);
                this.metadata.fileSizeBytes = stats.size;
            }
            this.metadata.status = 'completed';
        }
        this.saveMetadata();
        return this.metadata;
    }
    saveMetadata() {
        try {
            const metaPath = path_1.default.join(this.recordingsDir, `${this.sessionId}.json`);
            fs_1.default.writeFileSync(metaPath, JSON.stringify(this.metadata, null, 2));
        }
        catch (err) {
            this.logger.warn(`Failed to save recording metadata: ${err.message}`);
        }
    }
    static listRecordings(baseDir = process.cwd()) {
        const dir = path_1.default.join(baseDir, 'recordings');
        if (!fs_1.default.existsSync(dir))
            return [];
        const files = fs_1.default.readdirSync(dir).filter(f => f.endsWith('.json'));
        const list = [];
        for (const f of files) {
            try {
                const content = fs_1.default.readFileSync(path_1.default.join(dir, f), 'utf-8');
                list.push(JSON.parse(content));
            }
            catch (_) { }
        }
        return list.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    }
}
exports.SessionRecorder = SessionRecorder;
