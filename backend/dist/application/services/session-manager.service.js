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
    defaultKioskPackage = 'com.android.calculator2';
    constructor(devicePool, scrcpyManager) {
        this.devicePool = devicePool;
        this.scrcpyManager = scrcpyManager;
    }
    async detectKioskApp(serial) {
        try {
            const { stdout } = await execAsync(`adb -s ${serial} shell "pm list packages || true"`);
            const installed = stdout
                .split('\n')
                .map(line => line.trim().replace(/^package:/, ''))
                .filter(Boolean);
            // 1. Google Search / Web Browser (Highly interactive: typing, reading, writing, copy-paste)
            const browserPackages = [
                'com.android.chrome',
                'com.android.browser',
                'org.chromium.webview_shell',
                'com.google.android.googlequicksearchbox',
            ];
            for (const bPkg of browserPackages) {
                if (installed.includes(bPkg)) {
                    this.logger.info(`Detected interactive search/browser on ${serial}: ${bPkg}`);
                    return {
                        package: bPkg,
                        appName: 'Search',
                        launchCommand: `adb -s ${serial} shell "am start -a android.intent.action.VIEW -d 'https://www.google.com' || monkey -p ${bPkg} -c android.intent.category.LAUNCHER 1 || true"`,
                    };
                }
            }
            // 2. Android Files / DocumentsUI
            if (installed.includes('com.android.documentsui') || installed.includes('com.google.android.documentsui')) {
                const pkg = installed.includes('com.android.documentsui') ? 'com.android.documentsui' : 'com.google.android.documentsui';
                this.logger.info(`Detected Files app on ${serial}: ${pkg}`);
                return {
                    package: pkg,
                    appName: 'Files',
                    launchCommand: `adb -s ${serial} shell "am start -n ${pkg}/.files.FilesActivity || monkey -p ${pkg} -c android.intent.category.LAUNCHER 1 || true"`,
                };
            }
            // 3. Calculator candidates (OEM or AOSP)
            const calcCandidates = [
                'com.google.android.calculator',
                'com.android.calculator2',
                'com.android.calculator',
                'com.sec.android.app.popupcalculator',
                'com.simplemobiletools.calculator',
            ];
            for (const cPkg of calcCandidates) {
                if (installed.includes(cPkg)) {
                    this.logger.info(`Detected Calculator on ${serial}: ${cPkg}`);
                    return {
                        package: cPkg,
                        appName: 'Calculator',
                        launchCommand: `adb -s ${serial} shell "monkey -p ${cPkg} -c android.intent.category.LAUNCHER 1 || true"`,
                    };
                }
            }
            // 4. Try universal browser intent if not matched by name
            try {
                const { stdout: intentOut } = await execAsync(`adb -s ${serial} shell "cmd package resolve-activity -a android.intent.action.VIEW -d 'https://www.google.com' || true"`);
                if (intentOut && !intentOut.includes('No activity found')) {
                    const match = intentOut.match(/packageName=([a-zA-Z0-9_\.]+)/);
                    if (match && match[1] && !match[1].includes('android.fallback')) {
                        const pkg = match[1];
                        this.logger.info(`Resolved default web browser on ${serial}: ${pkg}`);
                        return {
                            package: pkg,
                            appName: 'Search',
                            launchCommand: `adb -s ${serial} shell "am start -a android.intent.action.VIEW -d 'https://www.google.com' || true"`,
                        };
                    }
                }
            }
            catch (_) { }
            // 5. Universal guaranteed fallback: Settings (contains interactive search bar to test input, keyboard, copy/paste)
            if (installed.includes('com.android.settings')) {
                this.logger.info(`Using Settings with interactive search as kiosk app on ${serial}`);
                return {
                    package: 'com.android.settings',
                    appName: 'Settings',
                    launchCommand: `adb -s ${serial} shell "am start -n com.android.settings/.Settings || monkey -p com.android.settings -c android.intent.category.LAUNCHER 1 || true"`,
                };
            }
        }
        catch (err) {
            this.logger.warn(`Failed detecting kiosk target on ${serial}: ${err.message}`);
        }
        return {
            package: 'com.android.settings',
            appName: 'Settings',
            launchCommand: `adb -s ${serial} shell "am start -n com.android.settings/.Settings || monkey -p com.android.settings -c android.intent.category.LAUNCHER 1 || true"`,
        };
    }
    async handleClientConnected(clientId, socket, clientToken = '') {
        this.logger.info(`Starting dedicated on-demand session for client: ${clientId} (token: ${clientToken})...`);
        // 1. Lease dedicated isolated device from pool
        const device = await this.devicePool.leaseDevice();
        // 2. Start dedicated scrcpy session for this device
        const scrcpySession = await this.scrcpyManager.startSession(device.serial);
        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const broadcaster = new websocket_broadcaster_adapter_js_1.WebSocketStreamBroadcaster();
        const recorder = new session_recorder_service_js_1.SessionRecorder(sessionId, device.serial, device.model, clientToken);
        // Detect installed interactive kiosk target dynamically (Google Search, Files, Calculator, or Settings)
        const kioskTarget = await this.detectKioskApp(device.serial);
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
            kioskPackage: kioskTarget.package,
            kioskAppName: kioskTarget.appName,
            kioskLaunchCommand: kioskTarget.launchCommand,
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
        // 4. Send init packet FIRST to client with dynamic interactive kiosk info
        socket.send(JSON.stringify({
            type: 'init',
            sessionId: session.sessionId,
            deviceModel: session.deviceModel,
            width: session.resolution.width,
            height: session.resolution.height,
            kioskPackage: session.kioskPackage,
            kioskAppName: session.kioskAppName,
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
                case 'stop_session':
                    this.logger.info(`Client ${clientId} requested explicit stop_session.`);
                    await this.terminateClientSession(session);
                    break;
                case 'save_recording': {
                    const targetId = event.sessionId || session.sessionId;
                    this.logger.info(`Client ${clientId} saved recording for ${targetId}`);
                    session_recorder_service_js_1.SessionRecorder.saveRecording(targetId);
                    if (session.socket.readyState === 1) {
                        session.socket.send(JSON.stringify({ type: 'recording_saved', sessionId: targetId }));
                    }
                    break;
                }
                case 'delete_recording': {
                    const targetId = event.sessionId || session.sessionId;
                    this.logger.info(`Client ${clientId} requested deletion of recording for ${targetId}`);
                    session_recorder_service_js_1.SessionRecorder.deleteRecording(targetId);
                    if (session.socket.readyState === 1) {
                        session.socket.send(JSON.stringify({ type: 'recording_deleted', sessionId: targetId }));
                    }
                    break;
                }
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
        session.kioskEnabled = enabled;
        if (session.kioskWatchdogInterval) {
            clearInterval(session.kioskWatchdogInterval);
            session.kioskWatchdogInterval = undefined;
        }
        if (enabled) {
            if (packageName) {
                session.kioskPackage = packageName;
                session.kioskLaunchCommand = `adb -s ${session.deviceSerial} shell "monkey -p ${packageName} -c android.intent.category.LAUNCHER 1 || true"`;
            }
            this.logger.info(`[Kiosk] Launching restricted app ${session.kioskAppName} (${session.kioskPackage}) on ${session.deviceSerial}...`);
            try {
                await execAsync(session.kioskLaunchCommand);
                await new Promise(r => setTimeout(r, 600));
                // Read active focus to confirm or update exact package
                const { stdout } = await execAsync(`adb -s ${session.deviceSerial} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true"`);
                const match = stdout.match(/([a-zA-Z0-9_\.]+)\/[a-zA-Z0-9_\.]+/);
                if (match && match[1] && !match[1].includes('SystemUI') && !match[1].includes('launcher')) {
                    session.kioskPackage = match[1];
                }
            }
            catch (err) {
                this.logger.warn(`Failed launching kiosk app: ${err.message}`);
            }
            session.scrcpySession.setKioskMode(true, session.kioskPackage);
            // Start Server-Side Kiosk Watchdog (Checks every 3s that user stays inside the app)
            session.kioskWatchdogInterval = setInterval(async () => {
                if (!session.kioskEnabled)
                    return;
                try {
                    const { stdout } = await execAsync(`adb -s ${session.deviceSerial} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true"`);
                    if (!stdout.includes(session.kioskPackage) && !stdout.includes('PopupWindow') && !stdout.includes('InputMethod')) {
                        this.logger.warn(`[Kiosk Security Watchdog] Unauthorized activity detected! Refocusing ${session.kioskPackage}...`);
                        await execAsync(session.kioskLaunchCommand);
                    }
                }
                catch (_) { }
            }, 3000);
        }
        else {
            this.logger.info(`[Kiosk] Kiosk mode disabled for ${session.sessionId}`);
            session.scrcpySession.setKioskMode(false);
        }
        // Inform client of kiosk state
        if (session.socket.readyState === 1) {
            session.socket.send(JSON.stringify({
                type: 'kiosk_status',
                enabled: session.kioskEnabled,
                package: session.kioskPackage,
                appName: session.kioskAppName,
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
        // Clean up client socket and send session_ended event
        const endedSessionId = session.sessionId;
        try {
            session.broadcaster.unregisterClient(session.clientId);
            if (session.socket.readyState === 1) {
                session.socket.send(JSON.stringify({
                    type: 'session_ended',
                    sessionId: endedSessionId,
                    deviceModel: session.deviceModel,
                    recordingUrl: `/api/recordings/${endedSessionId}`,
                }));
                // Give client a moment to receive the message before closing socket
                setTimeout(() => {
                    try {
                        if (session.socket.readyState === 1) {
                            session.socket.close();
                        }
                    }
                    catch (_) { }
                }, 3000);
            }
        }
        catch (_) { }
        // Auto-prune unsaved recording if session closed abandoned
        // If the recording is not saved within 60 seconds, delete it to prevent filling disk
        setTimeout(() => {
            const meta = session_recorder_service_js_1.SessionRecorder.getMetadata(endedSessionId);
            if (meta && meta.saved !== true) {
                this.logger.info(`Auto-pruning unsaved recording for ended session ${endedSessionId} to protect disk space`);
                session_recorder_service_js_1.SessionRecorder.deleteRecording(endedSessionId);
            }
        }, 60000);
        this.sessions.delete(session.clientId);
        this.logger.info(`Session ${endedSessionId} cleanly terminated and all resources freed.`);
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
