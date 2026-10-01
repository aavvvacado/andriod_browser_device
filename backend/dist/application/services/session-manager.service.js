"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManagerService = void 0;
const scrcpy_1 = require("@yume-chan/scrcpy");
const child_process_1 = require("child_process");
const util_1 = require("util");
const session_js_1 = require("../../domain/entities/session.js");
const websocket_broadcaster_adapter_js_1 = require("../../infrastructure/websocket/websocket-broadcaster.adapter.js");
const session_recorder_service_js_1 = require("../../infrastructure/recording/session-recorder.service.js");
const logger_js_1 = require("../../core/logger.js");
const config_js_1 = require("../../core/config.js");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class SessionManagerService {
    devicePool;
    scrcpyManager;
    logger = new logger_js_1.Logger('SessionManagerService');
    sessions = new Map();
    defaultKioskPackage = 'com.sec.android.app.popupcalculator';
    constructor(devicePool, scrcpyManager) {
        this.devicePool = devicePool;
        this.scrcpyManager = scrcpyManager;
    }
    async handleClientConnected(clientId, socket) {
        this.logger.info(`Starting dedicated on-demand session for client: ${clientId}...`);
        // 1. Lease dedicated isolated device from pool
        const device = await this.devicePool.leaseDevice();
        // 2. Start dedicated scrcpy session for this device
        const scrcpySession = await this.scrcpyManager.startSession(device.serial);
        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const broadcaster = new websocket_broadcaster_adapter_js_1.WebSocketStreamBroadcaster();
        const recorder = new session_recorder_service_js_1.SessionRecorder(sessionId, device.serial, device.model);
        const session = {
            sessionId,
            clientId,
            deviceSerial: device.serial,
            deviceModel: device.model,
            scrcpySession,
            broadcaster,
            recorder,
            socket,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            resolution: {
                width: scrcpySession.metadata.width,
                height: scrcpySession.metadata.height,
            },
            kioskEnabled: false,
            kioskPackage: this.defaultKioskPackage,
            broadcastActive: true,
        };
        this.sessions.set(clientId, session);
        // 3. Forward Android clipboard changes to this client (Bonus 3: Two-Way Clipboard)
        scrcpySession.setOnClipboard((text) => {
            this.logger.info(`Forwarding Android clipboard to client ${clientId}: "${text.substring(0, 30)}..."`);
            if (socket.readyState === 1) { // OPEN
                socket.send(JSON.stringify({
                    type: 'clipboard',
                    text,
                }));
            }
        });
        // 4. Send init packet FIRST to client
        socket.send(JSON.stringify({
            type: 'init',
            sessionId: session.sessionId,
            deviceModel: session.deviceModel,
            width: session.resolution.width,
            height: session.resolution.height,
        }));
        // 5. Register client in broadcaster
        broadcaster.registerClient(clientId, socket);
        // 6. Start broadcast and recording loop
        const reader = scrcpySession.getPacketReader();
        session.reader = reader;
        this.startBroadcastLoop(session, reader);
        // 7. Setup idle timer
        this.resetIdleTimer(session);
        return {
            id: session.sessionId,
            deviceSerial: session.deviceSerial,
            deviceModel: session.deviceModel,
            resolution: session.resolution,
            createdAt: session.createdAt,
            lastActivityAt: session.lastActivityAt,
            status: session_js_1.SessionStatus.ACTIVE,
        };
    }
    async handleClientDisconnected(clientId) {
        const session = this.sessions.get(clientId);
        if (!session)
            return;
        this.logger.info(`Client ${clientId} disconnected. Cleaning up dedicated session ${session.sessionId}...`);
        await this.terminateClientSession(session);
    }
    async handleClientInput(clientId, event) {
        const session = this.sessions.get(clientId);
        if (!session)
            return;
        session.lastActivityAt = Date.now();
        this.resetIdleTimer(session);
        try {
            switch (event.type) {
                case 'ping':
                    session.broadcaster.sendTo(clientId, JSON.stringify({
                        type: 'pong',
                        clientTime: event.clientTime,
                        serverTime: Date.now(),
                    }));
                    break;
                case 'touch':
                    await session.scrcpySession.injectTouch(event);
                    break;
                case 'scroll':
                    await session.scrcpySession.injectScroll(event);
                    break;
                case 'key':
                    await session.scrcpySession.injectKey(event);
                    break;
                case 'text':
                    await session.scrcpySession.injectText(event);
                    break;
                case 'clipboard':
                    // Bonus 3: User's computer clipboard pasted into Android device
                    await session.scrcpySession.setClipboard(event.text);
                    break;
                case 'kiosk_toggle':
                    // Bonus 4: Restricted access toggle
                    await this.setKioskMode(session, event.enabled, event.package);
                    break;
            }
        }
        catch (err) {
            this.logger.error(`Error injecting input event ${event.type}:`, err?.message || err);
            if (err?.code === 'EPIPE' || err?.message?.includes('ended by the other party')) {
                this.logger.warn('Underlying device socket ended. Cleaning up session...');
                await this.terminateClientSession(session);
            }
        }
    }
    async setKioskMode(session, enabled, packageName) {
        const targetPkg = packageName || this.defaultKioskPackage;
        session.kioskEnabled = enabled;
        session.kioskPackage = targetPkg;
        session.scrcpySession.setKioskMode(enabled, targetPkg);
        if (session.kioskWatchdogInterval) {
            clearInterval(session.kioskWatchdogInterval);
            session.kioskWatchdogInterval = undefined;
        }
        if (enabled) {
            this.logger.info(`[Kiosk] Launching restricted app ${targetPkg} on ${session.deviceSerial}...`);
            try {
                await execAsync(`adb -s ${session.deviceSerial} shell monkey -p ${targetPkg} -c android.intent.category.LAUNCHER 1`);
            }
            catch (err) {
                this.logger.warn(`Failed launching kiosk app: ${err.message}`);
            }
            // Start Server-Side Kiosk Watchdog (Checks every 3s that user stays inside the app)
            session.kioskWatchdogInterval = setInterval(async () => {
                if (!session.kioskEnabled)
                    return;
                try {
                    const { stdout } = await execAsync(`adb -s ${session.deviceSerial} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true"`);
                    if (!stdout.includes(session.kioskPackage) && !stdout.includes('PopupWindow')) {
                        this.logger.warn(`[Kiosk Security Watchdog] Unauthorized activity detected! Refocusing ${session.kioskPackage}...`);
                        await execAsync(`adb -s ${session.deviceSerial} shell monkey -p ${session.kioskPackage} -c android.intent.category.LAUNCHER 1`);
                    }
                }
                catch (_) { }
            }, 3000);
        }
        else {
            this.logger.info(`[Kiosk] Kiosk mode disabled for ${session.sessionId}`);
        }
        // Inform client of kiosk state
        if (session.socket.readyState === 1) {
            session.socket.send(JSON.stringify({
                type: 'kiosk_status',
                enabled: session.kioskEnabled,
                package: session.kioskPackage,
            }));
        }
    }
    async startBroadcastLoop(session, reader) {
        this.logger.info(`Broadcast loop started for session ${session.sessionId}`);
        try {
            while (session.broadcastActive) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                // 1. Write packet to automatic session recorder (Bonus 5)
                session.recorder.writePacket(value.data);
                // 2. Stream to browser WebCodecs decoder
                if (value.type === 'configuration') {
                    let codec = 'avc1.42001f';
                    try {
                        const parsed = (0, scrcpy_1.h264ParseConfiguration)(value.data);
                        codec = 'avc1.' + [parsed.profileIndex, parsed.constraintSet, parsed.levelIndex]
                            .map(x => x.toString(16).padStart(2, '0')).join('');
                    }
                    catch (e) {
                        this.logger.warn('Failed parsing SPS/PPS configuration, using default codec:', e.message);
                    }
                    const rawConfigBase64 = Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength).toString('base64');
                    session.broadcaster.broadcastConfig(codec, rawConfigBase64);
                }
                else if (value.type === 'data') {
                    const pts = value.pts !== undefined ? BigInt(value.pts) : 0n;
                    session.broadcaster.broadcastVideoFrame(!!value.keyframe, pts, value.data);
                }
            }
        }
        catch (err) {
            this.logger.error(`Broadcast stream error for ${session.sessionId}:`, err?.message || err);
        }
        finally {
            session.broadcastActive = false;
            try {
                reader.releaseLock();
            }
            catch (_) { }
            this.logger.info(`Broadcast loop finished for ${session.sessionId}`);
            await this.terminateClientSession(session);
        }
    }
    resetIdleTimer(session) {
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
        }
        session.idleTimer = setTimeout(async () => {
            this.logger.info(`Session ${session.sessionId} reached idle timeout (${config_js_1.config.idleTimeoutMs / 1000}s). Automatically releasing resources...`);
            await this.terminateClientSession(session);
        }, config_js_1.config.idleTimeoutMs);
    }
    async terminateClientSession(session) {
        session.broadcastActive = false;
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
            session.idleTimer = undefined;
        }
        if (session.kioskWatchdogInterval) {
            clearInterval(session.kioskWatchdogInterval);
            session.kioskWatchdogInterval = undefined;
        }
        // Stop and finalize session recording into MP4 container (Bonus 5)
        try {
            await session.recorder.stop();
        }
        catch (err) {
            this.logger.warn(`Failed cleanly stopping recorder: ${err.message}`);
        }
        // Close scrcpy session
        try {
            await session.scrcpySession.close();
        }
        catch (err) {
            this.logger.warn(`Failed closing scrcpy session: ${err.message}`);
        }
        // Release device back to pool (Bonus 1 & 2)
        try {
            await this.devicePool.releaseDevice(session.deviceSerial);
        }
        catch (err) {
            this.logger.warn(`Failed releasing device: ${err.message}`);
        }
        // Clean up client socket if open
        try {
            session.broadcaster.unregisterClient(session.clientId);
            if (session.socket.readyState === 1) {
                session.socket.send(JSON.stringify({ type: 'session_ended', sessionId: session.sessionId }));
                session.socket.close();
            }
        }
        catch (_) { }
        this.sessions.delete(session.clientId);
        this.logger.info(`Session ${session.sessionId} cleanly terminated and all resources freed.`);
    }
    async terminateAll() {
        this.logger.info(`Terminating all active sessions (${this.sessions.size})...`);
        for (const [, session] of this.sessions) {
            await this.terminateClientSession(session);
        }
    }
    getActiveSessions() {
        return Array.from(this.sessions.values()).map(s => ({
            id: s.sessionId,
            deviceSerial: s.deviceSerial,
            deviceModel: s.deviceModel,
            resolution: s.resolution,
            createdAt: s.createdAt,
            lastActivityAt: s.lastActivityAt,
            status: session_js_1.SessionStatus.ACTIVE,
        }));
    }
    getActiveSession() {
        const list = this.getActiveSessions();
        return list.length > 0 ? list[0] : null;
    }
}
exports.SessionManagerService = SessionManagerService;
