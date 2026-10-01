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
    clientToken;
    logger = new logger_js_1.Logger('SessionRecorder');
    recordingsDir;
    writeStream = null;
    metadata;
    isClosed = false;
    constructor(sessionId, deviceSerial, deviceModel, clientToken = '', baseDir = process.cwd()) {
        this.sessionId = sessionId;
        this.deviceSerial = deviceSerial;
        this.deviceModel = deviceModel;
        this.clientToken = clientToken;
        this.recordingsDir = path_1.default.join(baseDir, 'recordings');
        if (!fs_1.default.existsSync(this.recordingsDir)) {
            fs_1.default.mkdirSync(this.recordingsDir, { recursive: true });
        }
        const rawFilePath = path_1.default.join(this.recordingsDir, `${sessionId}.h264`);
        this.writeStream = fs_1.default.createWriteStream(rawFilePath, { flags: 'a' });
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
    static getMetadata(sessionId, baseDir = process.cwd()) {
        const metaPath = path_1.default.join(baseDir, 'recordings', `${sessionId}.json`);
        if (!fs_1.default.existsSync(metaPath))
            return null;
        try {
            return JSON.parse(fs_1.default.readFileSync(metaPath, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    static saveRecording(sessionId, baseDir = process.cwd()) {
        const dir = path_1.default.join(baseDir, 'recordings');
        const metaPath = path_1.default.join(dir, `${sessionId}.json`);
        if (!fs_1.default.existsSync(metaPath))
            return null;
        try {
            const meta = JSON.parse(fs_1.default.readFileSync(metaPath, 'utf-8'));
            meta.saved = true;
            fs_1.default.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
            const logger = new logger_js_1.Logger('SessionRecorder');
            logger.info(`Marked session recording ${sessionId} as permanently SAVED`);
            return meta;
        }
        catch {
            return null;
        }
    }
    static deleteRecording(sessionId, baseDir = process.cwd()) {
        const dir = path_1.default.join(baseDir, 'recordings');
        const logger = new logger_js_1.Logger('SessionRecorder');
        let deletedAny = false;
        const filesToDelete = [
            path_1.default.join(dir, `${sessionId}.h264`),
            path_1.default.join(dir, `${sessionId}.mp4`),
            path_1.default.join(dir, `${sessionId}.json`),
        ];
        for (const f of filesToDelete) {
            if (fs_1.default.existsSync(f)) {
                try {
                    fs_1.default.unlinkSync(f);
                    deletedAny = true;
                }
                catch (err) {
                    logger.warn(`Could not delete recording file ${f}: ${err.message}`);
                }
            }
        }
        if (deletedAny) {
            logger.info(`Deleted session recording files for ${sessionId} to reclaim disk space`);
        }
        return deletedAny;
    }
    static pruneUnsaved(maxAgeMs = 180000, baseDir = process.cwd()) {
        const dir = path_1.default.join(baseDir, 'recordings');
        if (!fs_1.default.existsSync(dir))
            return 0;
        const now = Date.now();
        let prunedCount = 0;
        const jsonFiles = fs_1.default.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const jf of jsonFiles) {
            const metaPath = path_1.default.join(dir, jf);
            try {
                const meta = JSON.parse(fs_1.default.readFileSync(metaPath, 'utf-8'));
                const age = now - (meta.startTime || 0);
                // If not explicitly saved and exceeds maxAgeMs, prune files
                if (meta.saved !== true && age > maxAgeMs) {
                    SessionRecorder.deleteRecording(meta.sessionId, baseDir);
                    prunedCount++;
                }
            }
            catch {
                // Corrupt JSON, delete it
                try {
                    fs_1.default.unlinkSync(metaPath);
                }
                catch { }
            }
        }
        return prunedCount;
    }
    static listRecordings(baseDir = process.cwd(), onlySaved = false, clientToken) {
        const dir = path_1.default.join(baseDir, 'recordings');
        if (!fs_1.default.existsSync(dir))
            return [];
        const files = fs_1.default.readdirSync(dir).filter(f => f.endsWith('.json'));
        const list = [];
        for (const f of files) {
            try {
                const content = fs_1.default.readFileSync(path_1.default.join(dir, f), 'utf-8');
                const meta = JSON.parse(content);
                if (onlySaved && meta.saved !== true)
                    continue;
                // Machine / Client Isolation:
                // Ensure recordings on server are never visible to users on different machines
                if (clientToken && meta.clientToken && meta.clientToken !== clientToken) {
                    continue;
                }
                list.push(meta);
            }
            catch (_) { }
        }
        return list.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    }
}
exports.SessionRecorder = SessionRecorder;
