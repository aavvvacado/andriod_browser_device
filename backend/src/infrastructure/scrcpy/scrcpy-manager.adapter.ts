import fs from 'fs';
import { AdbScrcpyClient, AdbScrcpyOptions2_7 } from '@yume-chan/adb-scrcpy';
import { AndroidMotionEventAction, AndroidKeyCode, ScrcpyInstanceId } from '@yume-chan/scrcpy';
import { Adb } from '@yume-chan/adb';
import { IScrcpyManager, IScrcpySession, ScrcpyPacket, ScrcpyStreamMetadata } from '../../domain/repositories/scrcpy.interface.js';
import { TouchInputEvent, KeyInputEvent, TextInputEvent, ScrollInputEvent } from '../../domain/entities/input-event.js';
import { AdbDevicePoolAdapter } from '../adb/adb-device-pool.adapter.js';
import { Logger } from '../../core/logger.js';
import { config } from '../../core/config.js';

export class ScrcpySessionAdapter implements IScrcpySession {
  private logger = new Logger('ScrcpySessionAdapter');
  private isPointerDown: boolean = false;
  private isBlockedGesture: boolean = false;
  private _isKioskMode: boolean = false;
  private allowedPackage: string = 'com.android.calculator2';
  private clipboardCallback: ((text: string) => void) | null = null;

  constructor(
    public metadata: ScrcpyStreamMetadata,
    private scrcpyClient: any,
    private packetStream: any
  ) {}

  getPacketReader(): ReadableStreamDefaultReader<ScrcpyPacket> {
    return this.packetStream.getReader();
  }

  setKioskMode(enabled: boolean, allowedPackage?: string): void {
    this._isKioskMode = enabled;
    if (allowedPackage) {
      this.allowedPackage = allowedPackage;
    }
    this.logger.info(`Kiosk mode ${enabled ? 'ENABLED' : 'DISABLED'} for package: ${this.allowedPackage}`);
  }

  isKioskMode(): boolean {
    return this._isKioskMode;
  }

  setOnClipboard(callback: (text: string) => void): void {
    this.clipboardCallback = callback;
  }

  emitClipboard(text: string): void {
    if (this.clipboardCallback) {
      this.clipboardCallback(text);
    }
  }

  async injectTouch(event: TouchInputEvent): Promise<void> {
    if (!this.scrcpyClient.controller) return;

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
      } else if (this.isBlockedGesture) {
        if (event.action === 'up') {
          this.isBlockedGesture = false;
        }
        return;
      }
    }

    let action: any;
    if (event.action === 'down') {
      if (this.isPointerDown) {
        // Synthesize Up before injecting new Down to ensure clean state machine
        this.logger.debug(`Resetting previous pointer down before new touch at (${Math.round(event.x)}, ${Math.round(event.y)})`);
        await this.scrcpyClient.controller.injectTouch({
          action: AndroidMotionEventAction.Up,
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
      action = AndroidMotionEventAction.Down;
    } else if (event.action === 'move') {
      if (!this.isPointerDown) {
        // Drop mouse hover moves when button is not held down
        return;
      }
      action = AndroidMotionEventAction.Move;
    } else if (event.action === 'up') {
      this.isPointerDown = false;
      action = AndroidMotionEventAction.Up;
    }

    if (action === undefined) return;

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

  async injectScroll(event: ScrollInputEvent): Promise<void> {
    if (!this.scrcpyClient.controller) return;

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

  async injectKey(event: KeyInputEvent): Promise<void> {
    if (!this.scrcpyClient.controller) return;

    // Server-Side Kiosk Enforcement: Block system exit keys
    if (this._isKioskMode) {
      if (
        event.key === 'Home' ||
        event.key === 'Recents' ||
        event.key === 'AppSwitch' ||
        event.key === 'Power' ||
        event.key === 'VolumeUp' ||
        event.key === 'VolumeDown'
      ) {
        this.logger.warn(`[Kiosk Security] Intercepted and blocked prohibited key: ${event.key}`);
        return;
      }
    }

    let keyCode: number;
    switch (event.key) {
      case 'Home': keyCode = AndroidKeyCode.AndroidHome; break;
      case 'Back': keyCode = AndroidKeyCode.AndroidBack; break;
      case 'Recents':
      case 'AppSwitch': keyCode = AndroidKeyCode.AndroidAppSwitch; break;
      case 'Power': keyCode = AndroidKeyCode.Power; break;
      case 'VolumeUp': keyCode = AndroidKeyCode.VolumeUp; break;
      case 'VolumeDown': keyCode = AndroidKeyCode.VolumeDown; break;
      case 'Enter': keyCode = AndroidKeyCode.Enter; break;
      case 'Backspace': keyCode = AndroidKeyCode.Backspace; break;
      case 'Tab': keyCode = AndroidKeyCode.Tab; break;
      case 'Escape': keyCode = AndroidKeyCode.Escape; break;
      case 'Delete': keyCode = AndroidKeyCode.Delete; break;
      case 'ArrowUp': keyCode = AndroidKeyCode.ArrowUp; break;
      case 'ArrowDown': keyCode = AndroidKeyCode.ArrowDown; break;
      case 'ArrowLeft': keyCode = AndroidKeyCode.ArrowLeft; break;
      case 'ArrowRight': keyCode = AndroidKeyCode.ArrowRight; break;
      default: return;
    }

    this.logger.info(`Injecting key to scrcpy: ${event.key} (code=${keyCode})`);

    // Key down + key up
    await this.scrcpyClient.controller.injectKeyCode({ keyCode, action: 0 });
    await this.scrcpyClient.controller.injectKeyCode({ keyCode, action: 1 });
  }

  async injectText(event: TextInputEvent): Promise<void> {
    if (!this.scrcpyClient.controller || !event.text) return;
    this.logger.info(`Injecting text to scrcpy: "${event.text}"`);
    await this.scrcpyClient.controller.injectText(event.text);
  }

  async setClipboard(text: string): Promise<void> {
    if (!this.scrcpyClient.controller || !text) return;
    this.logger.info(`Setting Android clipboard from browser (${text.length} chars)`);
    await this.scrcpyClient.controller.setClipboard({
      content: text,
      paste: true, // Auto-paste into focused application
    });
  }

  async close(): Promise<void> {
    try {
      await this.scrcpyClient.close();
      this.logger.info('Scrcpy session closed cleanly');
    } catch (err: any) {
      this.logger.error('Error closing scrcpy session', err);
    }
  }
}

export class ScrcpyManagerAdapter implements IScrcpyManager {
  private logger = new Logger('ScrcpyManagerAdapter');

  constructor(private adbPool: AdbDevicePoolAdapter) {}

  async startSession(serial: string): Promise<IScrcpySession> {
    this.logger.info(`Starting scrcpy session on device ${serial}...`);
    const adb: Adb = await this.adbPool.createAdbTransport(serial);

    // Push scrcpy-server.jar if needed
    if (!fs.existsSync(config.scrcpyServerPath)) {
      throw new Error(`scrcpy-server.jar not found at ${config.scrcpyServerPath}`);
    }

    const serverBuffer = fs.readFileSync(config.scrcpyServerPath);
    const fileStream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(serverBuffer));
        c.close();
      }
    });

    await AdbScrcpyClient.pushServer(adb, fileStream as any, '/data/local/tmp/scrcpy-server.jar');

    const options = new AdbScrcpyOptions2_7({
      scid: ScrcpyInstanceId.random(),
      maxSize: config.maxVideoSize,
      videoBitRate: config.maxVideoBitrate,
      tunnelForward: true,
      audio: false,
      control: true,
      clipboardAutosync: true,
    });

    const scrcpy = await AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', options);
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

    const metadata: ScrcpyStreamMetadata = {
      deviceName: videoStream.metadata.deviceName || 'Android Device',
      width,
      height,
      codec: videoStream.metadata.codec ?? 0,
    };

    this.logger.info(`Scrcpy running on ${serial}! Metadata:`, metadata);

    const sessionAdapter = new ScrcpySessionAdapter(metadata, scrcpy, videoStream.stream);

    // Listen to Android device clipboard stream and forward to sessionAdapter
    const clipboardStream: any = scrcpy.clipboard;
    if (clipboardStream) {
      (async () => {
        try {
          const reader = clipboardStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              sessionAdapter.emitClipboard(value);
            }
          }
        } catch (err: any) {
          this.logger.debug(`Clipboard stream closed: ${err?.message || err}`);
        }
      })();
    }

    return sessionAdapter;
  }
}

