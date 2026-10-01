"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScrcpyManagerAdapter = exports.ScrcpySessionAdapter = void 0;
const fs_1 = __importDefault(require("fs"));
const adb_scrcpy_1 = require("@yume-chan/adb-scrcpy");
const scrcpy_1 = require("@yume-chan/scrcpy");
const logger_js_1 = require("../../core/logger.js");
const config_js_1 = require("../../core/config.js");
class ScrcpySessionAdapter {
    metadata;
    scrcpyClient;
    packetStream;
    logger = new logger_js_1.Logger('ScrcpySessionAdapter');
    isPointerDown = false;
    isBlockedGesture = false;
    _isKioskMode = false;
    allowedPackage = 'com.sec.android.app.popupcalculator';
    clipboardCallback = null;
    constructor(metadata, scrcpyClient, packetStream) {
        this.metadata = metadata;
        this.scrcpyClient = scrcpyClient;
        this.packetStream = packetStream;
    }
    getPacketReader() {
        return this.packetStream.getReader();
    }
    setKioskMode(enabled, allowedPackage) {
        this._isKioskMode = enabled;
        if (allowedPackage) {
            this.allowedPackage = allowedPackage;
        }
        this.logger.info(`Kiosk mode ${enabled ? 'ENABLED' : 'DISABLED'} for package: ${this.allowedPackage}`);
    }
    isKioskMode() {
        return this._isKioskMode;
    }
    setOnClipboard(callback) {
        this.clipboardCallback = callback;
    }
    emitClipboard(text) {
        if (this.clipboardCallback) {
            this.clipboardCallback(text);
        }
    }
    async injectTouch(event) {
        if (!this.scrcpyClient.controller)
            return;
        const videoWidth = event.screenWidth || this.metadata.width || 1080;
        const videoHeight = event.screenHeight || this.metadata.height || 2408;
        // Server-Side Kiosk Enforcement: Block notification pull-down & bottom gesture navigation
        if (this._isKioskMode) {
            if (event.action === 'down') {
                const topMargin = Math.max(50, videoHeight * 0.05);
                const bottomMargin = videoHeight - Math.max(45, videoHeight * 0.04);
                if (event.y <= topMargin) {
                    this.isBlockedGesture = true;
                    this.logger.warn(`[Kiosk Security] Intercepted and blocked status bar pull-down at y=${Math.round(event.y)}`);
                    return;
                }
                if (event.y >= bottomMargin) {
                    this.isBlockedGesture = true;
                    this.logger.warn(`[Kiosk Security] Intercepted and blocked bottom navigation swipe at y=${Math.round(event.y)}`);
                    return;
                }
                this.isBlockedGesture = false;
            }
            else if (this.isBlockedGesture) {
                if (event.action === 'up') {
                    this.isBlockedGesture = false;
                }
                return;
            }
        }
        let action;
        if (event.action === 'down') {
            if (this.isPointerDown) {
                // Synthesize Up before injecting new Down to ensure clean state machine
                this.logger.debug(`Resetting previous pointer down before new touch at (${Math.round(event.x)}, ${Math.round(event.y)})`);
                await this.scrcpyClient.controller.injectTouch({
                    action: scrcpy_1.AndroidMotionEventAction.Up,
                    pointerId: BigInt(event.pointerId ?? 0),
                    pointerX: Math.round(event.x),
                    pointerY: Math.round(event.y),
                    videoWidth,
                    videoHeight,
                    pressure: 0.0,
                    actionButton: 0,
                    buttons: 0,
                });
            }
            this.isPointerDown = true;
            action = scrcpy_1.AndroidMotionEventAction.Down;
        }
        else if (event.action === 'move') {
            if (!this.isPointerDown) {
                // Drop mouse hover moves when button is not held down
                return;
            }
            action = scrcpy_1.AndroidMotionEventAction.Move;
        }
        else if (event.action === 'up') {
            this.isPointerDown = false;
            action = scrcpy_1.AndroidMotionEventAction.Up;
        }
        if (action === undefined)
            return;
        this.logger.info(`Injecting touch to scrcpy: action=${event.action} (${action}) at (${Math.round(event.x)}, ${Math.round(event.y)}) in ${videoWidth}x${videoHeight}`);
        await this.scrcpyClient.controller.injectTouch({
            action,
            pointerId: BigInt(event.pointerId ?? 0),
            pointerX: Math.round(event.x),
            pointerY: Math.round(event.y),
            videoWidth,
            videoHeight,
            pressure: event.action === 'up' ? 0.0 : (event.pressure ?? 1.0),
            actionButton: 0,
            buttons: 0,
        });
    }
    async injectScroll(event) {
        if (!this.scrcpyClient.controller)
            return;
        const videoWidth = event.screenWidth || this.metadata.width || 1080;
        const videoHeight = event.screenHeight || this.metadata.height || 2408;
        // Scrcpy expects signed float -1.0 to 1.0
        const scrollX = Math.max(-1, Math.min(1, event.distanceX === 0 ? 0 : Math.sign(event.distanceX)));
        const scrollY = Math.max(-1, Math.min(1, event.distanceY === 0 ? 0 : -Math.sign(event.distanceY)));
        this.logger.info(`Injecting scroll to scrcpy at (${Math.round(event.x)}, ${Math.round(event.y)}) scrollX=${scrollX}, scrollY=${scrollY}`);
        await this.scrcpyClient.controller.injectScroll({
            pointerX: Math.round(event.x),
            pointerY: Math.round(event.y),
            videoWidth,
            videoHeight,
            scrollX,
            scrollY,
            buttons: 0,
        });
    }
    async injectKey(event) {
        if (!this.scrcpyClient.controller)
            return;
        // Server-Side Kiosk Enforcement: Block system exit keys
        if (this._isKioskMode) {
            if (event.key === 'Home' ||
                event.key === 'Recents' ||
                event.key === 'AppSwitch' ||
                event.key === 'Power' ||
                event.key === 'VolumeUp' ||
                event.key === 'VolumeDown') {
                this.logger.warn(`[Kiosk Security] Intercepted and blocked prohibited key: ${event.key}`);
                return;
            }
        }
        let keyCode;
        switch (event.key) {
            case 'Home':
                keyCode = scrcpy_1.AndroidKeyCode.AndroidHome;
                break;
            case 'Back':
                keyCode = scrcpy_1.AndroidKeyCode.AndroidBack;
                break;
            case 'Recents':
            case 'AppSwitch':
                keyCode = scrcpy_1.AndroidKeyCode.AndroidAppSwitch;
                break;
            case 'Power':
                keyCode = scrcpy_1.AndroidKeyCode.Power;
                break;
            case 'VolumeUp':
                keyCode = scrcpy_1.AndroidKeyCode.VolumeUp;
                break;
            case 'VolumeDown':
                keyCode = scrcpy_1.AndroidKeyCode.VolumeDown;
                break;
            case 'Enter':
                keyCode = scrcpy_1.AndroidKeyCode.Enter;
                break;
            case 'Backspace':
                keyCode = scrcpy_1.AndroidKeyCode.Backspace;
                break;
            case 'Tab':
                keyCode = scrcpy_1.AndroidKeyCode.Tab;
                break;
            case 'Escape':
                keyCode = scrcpy_1.AndroidKeyCode.Escape;
                break;
            case 'Delete':
                keyCode = scrcpy_1.AndroidKeyCode.Delete;
                break;
            case 'ArrowUp':
                keyCode = scrcpy_1.AndroidKeyCode.ArrowUp;
                break;
            case 'ArrowDown':
                keyCode = scrcpy_1.AndroidKeyCode.ArrowDown;
                break;
            case 'ArrowLeft':
                keyCode = scrcpy_1.AndroidKeyCode.ArrowLeft;
                break;
            case 'ArrowRight':
                keyCode = scrcpy_1.AndroidKeyCode.ArrowRight;
                break;
            default: return;
        }
        this.logger.info(`Injecting key to scrcpy: ${event.key} (code=${keyCode})`);
        // Key down + key up
        await this.scrcpyClient.controller.injectKeyCode({ keyCode, action: 0 });
        await this.scrcpyClient.controller.injectKeyCode({ keyCode, action: 1 });
    }
    async injectText(event) {
        if (!this.scrcpyClient.controller || !event.text)
            return;
        this.logger.info(`Injecting text to scrcpy: "${event.text}"`);
        await this.scrcpyClient.controller.injectText(event.text);
    }
    async setClipboard(text) {
        if (!this.scrcpyClient.controller || !text)
            return;
        this.logger.info(`Setting Android clipboard from browser (${text.length} chars)`);
        await this.scrcpyClient.controller.setClipboard({
            content: text,
            paste: true, // Auto-paste into focused application
        });
    }
    async close() {
        try {
            await this.scrcpyClient.close();
            this.logger.info('Scrcpy session closed cleanly');
        }
        catch (err) {
            this.logger.error('Error closing scrcpy session', err);
        }
    }
}
exports.ScrcpySessionAdapter = ScrcpySessionAdapter;
class ScrcpyManagerAdapter {
    adbPool;
    logger = new logger_js_1.Logger('ScrcpyManagerAdapter');
    constructor(adbPool) {
        this.adbPool = adbPool;
    }
    async startSession(serial) {
        this.logger.info(`Starting scrcpy session on device ${serial}...`);
        const adb = await this.adbPool.createAdbTransport(serial);
        // Push scrcpy-server.jar if needed
        if (!fs_1.default.existsSync(config_js_1.config.scrcpyServerPath)) {
            throw new Error(`scrcpy-server.jar not found at ${config_js_1.config.scrcpyServerPath}`);
        }
        const serverBuffer = fs_1.default.readFileSync(config_js_1.config.scrcpyServerPath);
        const fileStream = new ReadableStream({
            start(c) {
                c.enqueue(new Uint8Array(serverBuffer));
                c.close();
            }
        });
        await adb_scrcpy_1.AdbScrcpyClient.pushServer(adb, fileStream, '/data/local/tmp/scrcpy-server.jar');
        const options = new adb_scrcpy_1.AdbScrcpyOptions2_7({
            scid: scrcpy_1.ScrcpyInstanceId.random(),
            maxSize: config_js_1.config.maxVideoSize,
            videoBitRate: config_js_1.config.maxVideoBitrate,
            tunnelForward: true,
            audio: false,
            control: true,
            clipboardAutosync: true,
        });
        const scrcpy = await adb_scrcpy_1.AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', options);
        const videoStream = await scrcpy.videoStream;
        if (!videoStream) {
            throw new Error(`Failed to initialize video stream from scrcpy on device ${serial}`);
        }
        let width = videoStream.metadata.width ?? 0;
        let height = videoStream.metadata.height ?? 0;
        if (width === 0 || height === 0) {
            width = 1080;
            height = 2408;
        }
        const metadata = {
            deviceName: videoStream.metadata.deviceName || 'Android Device',
            width,
            height,
            codec: videoStream.metadata.codec ?? 0,
        };
        this.logger.info(`Scrcpy running on ${serial}! Metadata:`, metadata);
        const sessionAdapter = new ScrcpySessionAdapter(metadata, scrcpy, videoStream.stream);
        // Listen to Android device clipboard stream and forward to sessionAdapter
        const clipboardStream = scrcpy.clipboard;
        if (clipboardStream) {
            (async () => {
                try {
                    const reader = clipboardStream.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        if (value) {
                            sessionAdapter.emitClipboard(value);
                        }
                    }
                }
                catch (err) {
                    this.logger.debug(`Clipboard stream closed: ${err?.message || err}`);
                }
            })();
        }
        return sessionAdapter;
    }
}
exports.ScrcpyManagerAdapter = ScrcpyManagerAdapter;
