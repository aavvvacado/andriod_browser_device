import { h264ParseConfiguration } from '@yume-chan/scrcpy';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IDevicePoolRepository } from '../../domain/repositories/device-pool.repository.js';
import { IScrcpyManager, IScrcpySession, ScrcpyPacket } from '../../domain/repositories/scrcpy.interface.js';
import { DeviceSession, SessionStatus } from '../../domain/entities/session.js';
import { ClientInputEvent } from '../../domain/entities/input-event.js';
import { WebSocketStreamBroadcaster } from '../../infrastructure/websocket/websocket-broadcaster.adapter.js';
import { Logger } from '../../core/logger.js';
import { config } from '../../core/config.js';

const execAsync = promisify(exec);

interface ActiveClientSession {
  sessionId: string;
  clientId: string;
  deviceSerial: string;
  deviceModel: string;
  scrcpySession: IScrcpySession;
  broadcaster: WebSocketStreamBroadcaster;
  socket: any;
  createdAt: number;
  lastActivityAt: number;
  resolution: { width: number; height: number };
  kioskEnabled: boolean;
  kioskPackage: string;
  kioskAppName: string;
  kioskLaunchCommand: string;
  kioskWatchdogInterval?: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
  broadcastActive: boolean;
  reader?: ReadableStreamDefaultReader<ScrcpyPacket>;
}

export class SessionManagerService {
  private logger = new Logger('SessionManagerService');
  private sessions: Map<string, ActiveClientSession> = new Map();
  private defaultKioskPackage = 'com.android.calculator2';

  constructor(
    private devicePool: IDevicePoolRepository,
    private scrcpyManager: IScrcpyManager
  ) {}

  private async detectKioskApp(serial: string): Promise<{ package: string; appName: string; launchCommand: string }> {
    try {
      // 1. Primary: Query Android's package manager for whatever app handles Google Web Search
      try {
        const { stdout: intentOut } = await execAsync(`adb -s ${serial} shell "cmd package resolve-activity -a android.intent.action.VIEW -d 'https://www.google.com' || true"`);
        if (intentOut && !intentOut.includes('No activity found')) {
          const match = intentOut.match(/packageName=([a-zA-Z0-9_\.]+)/);
          if (match && match[1] && !match[1].includes('android.fallback')) {
            const pkg = match[1];
            this.logger.info(`Resolved web browser for Google Search on ${serial}: ${pkg}`);
            return {
              package: pkg,
              appName: 'Google Search',
              launchCommand: `adb -s ${serial} shell "am start -a android.intent.action.VIEW -d 'https://www.google.com' || monkey -p ${pkg} -c android.intent.category.LAUNCHER 1 || true"`,
            };
          }
        }
      } catch (_) {}

      const { stdout } = await execAsync(`adb -s ${serial} shell "pm list packages || true"`);
      const installed = stdout
        .split('\n')
        .map(line => line.trim().replace(/^package:/, ''))
        .filter(Boolean);

      // 2. Specific Google / Chrome / Browser packages installed on device
      const browserPackages = [
        { pkg: 'com.android.chrome', name: 'Google Chrome', cmd: `am start -n com.android.chrome/com.google.android.apps.chrome.Main -d 'https://www.google.com' || am start -a android.intent.action.VIEW -d 'https://www.google.com'` },
        { pkg: 'com.google.android.googlequicksearchbox', name: 'Google Search', cmd: `am start -n com.google.android.googlequicksearchbox/com.google.android.googlequicksearchbox.SearchActivity || am start -a android.intent.action.VIEW -d 'https://www.google.com'` },
        { pkg: 'org.chromium.webview_shell', name: 'Web Browser', cmd: `am start -n org.chromium.webview_shell/.WebViewBrowserActivity -d 'https://www.google.com' || am start -a android.intent.action.VIEW -d 'https://www.google.com'` },
        { pkg: 'com.android.browser', name: 'Web Browser', cmd: `am start -a android.intent.action.VIEW -d 'https://www.google.com'` },
      ];
      for (const item of browserPackages) {
        if (installed.includes(item.pkg)) {
          this.logger.info(`Detected interactive Google/Browser on ${serial}: ${item.pkg}`);
          return {
            package: item.pkg,
            appName: 'Google Search',
            launchCommand: `adb -s ${serial} shell "${item.cmd} || true"`,
          };
        }
      }

      // 3. Android Files / DocumentsUI (if present on device)
      if (installed.includes('com.android.documentsui') || installed.includes('com.google.android.documentsui')) {
        const pkg = installed.includes('com.android.documentsui') ? 'com.android.documentsui' : 'com.google.android.documentsui';
        this.logger.info(`Detected Files app on ${serial}: ${pkg}`);
        return {
          package: pkg,
          appName: 'Files',
          launchCommand: `adb -s ${serial} shell "am start -n ${pkg}/.files.FilesActivity || monkey -p ${pkg} -c android.intent.category.LAUNCHER 1 || true"`,
        };
      }

      // 4. Universal guaranteed fallback for minimal Redroid AOSP: Settings (contains interactive search bar to test input, keyboard, copy/paste)
      if (installed.includes('com.android.settings')) {
        this.logger.info(`Using Settings with interactive search as kiosk app on ${serial}`);
        return {
          package: 'com.android.settings',
          appName: 'Google Search',
          launchCommand: `adb -s ${serial} shell "am start -a android.intent.action.VIEW -d 'https://www.google.com' || am start -n com.android.settings/.Settings || monkey -p com.android.settings -c android.intent.category.LAUNCHER 1 || true"`,
        };
      }
    } catch (err: any) {
      this.logger.warn(`Failed detecting kiosk target on ${serial}: ${err.message}`);
    }

    return {
      package: 'com.android.settings',
      appName: 'Google Search',
      launchCommand: `adb -s ${serial} shell "am start -a android.intent.action.VIEW -d 'https://www.google.com' || am start -n com.android.settings/.Settings || true"`,
    };
  }

  async handleClientConnected(clientId: string, socket: any, clientToken: string = ''): Promise<DeviceSession> {
    this.logger.info(`Starting dedicated on-demand session for client: ${clientId} (token: ${clientToken})...`);

    // 1. Lease dedicated isolated device from pool
    const device = await this.devicePool.leaseDevice();

    // 2. Start dedicated scrcpy session for this device
    const scrcpySession = await this.scrcpyManager.startSession(device.serial);

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const broadcaster = new WebSocketStreamBroadcaster();

    // Detect installed interactive kiosk target dynamically (Google Search, Files, Calculator, or Settings)
    const kioskTarget = await this.detectKioskApp(device.serial);

    const session: ActiveClientSession = {
      sessionId,
      clientId,
      deviceSerial: device.serial,
      deviceModel: device.model,
      scrcpySession,
      broadcaster,
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
    scrcpySession.setOnClipboard((text: string) => {
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
      status: SessionStatus.ACTIVE,
    };
  }

  async handleClientDisconnected(clientId: string): Promise<void> {
    const session = this.sessions.get(clientId);
    if (!session) return;

    this.logger.info(`Client ${clientId} disconnected. Cleaning up dedicated session ${session.sessionId}...`);
    await this.terminateClientSession(session);
  }

  async handleClientInput(clientId: string, event: ClientInputEvent): Promise<void> {
    const session = this.sessions.get(clientId);
    if (!session) return;

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
      }
    } catch (err: any) {
      this.logger.error(`Error injecting input event ${event.type}:`, err?.message || err);
      if (err?.code === 'EPIPE' || err?.message?.includes('ended by the other party')) {
        this.logger.warn('Underlying device socket ended. Cleaning up session...');
        await this.terminateClientSession(session);
      }
    }
  }

  async setKioskMode(session: ActiveClientSession, enabled: boolean, packageName?: string): Promise<void> {
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
        const { stdout } = await execAsync(`adb -s ${session.deviceSerial} shell "dumpsys window displays | grep -E 'mCurrentFocus|mFocusedApp' || dumpsys activity activities | grep ResumedActivity || dumpsys window | grep mCurrentFocus || true"`);
        const match = stdout.match(/([a-zA-Z0-9_\.]+)\/[a-zA-Z0-9_\.]+/);
        if (match && match[1] && !match[1].includes('SystemUI') && !match[1].includes('systemui') && !match[1].includes('launcher')) {
          session.kioskPackage = match[1];
        }
      } catch (err: any) {
        this.logger.warn(`Failed launching kiosk app: ${err.message}`);
      }

      session.scrcpySession.setKioskMode(true, session.kioskPackage);

      // Start Server-Side Kiosk Watchdog (Checks every 3s that user stays inside the app)
      session.kioskWatchdogInterval = setInterval(async () => {
        if (!session.kioskEnabled) return;
        try {
          const { stdout } = await execAsync(`adb -s ${session.deviceSerial} shell "dumpsys window displays | grep -E 'mCurrentFocus|mFocusedApp' || dumpsys activity activities | grep ResumedActivity || dumpsys window | grep mCurrentFocus || true"`);
          if (
            stdout &&
            !stdout.includes(session.kioskPackage) &&
            !stdout.includes('PopupWindow') &&
            !stdout.includes('InputMethod') &&
            !stdout.includes('VolumeDialogImpl') &&
            !stdout.includes('Toast')
          ) {
            const match = stdout.match(/([a-zA-Z0-9_\.]+)\/[a-zA-Z0-9_\.]+/);
            const activePkg = match ? match[1] : '';
            if (activePkg && activePkg !== session.kioskPackage && !activePkg.includes('SystemUI') && !activePkg.includes('systemui')) {
              this.logger.warn(`[Kiosk Security Watchdog] Unauthorized activity ${activePkg} detected on ${session.deviceSerial}! Refocusing ${session.kioskPackage}...`);
              await execAsync(session.kioskLaunchCommand);
            }
          }
        } catch (_) {}
      }, 3000);
    } else {
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

  private async startBroadcastLoop(
    session: ActiveClientSession,
    reader: ReadableStreamDefaultReader<ScrcpyPacket>
  ): Promise<void> {
    this.logger.info(`Broadcast loop started for session ${session.sessionId}`);

    try {
      while (session.broadcastActive) {
        const { done, value } = await reader.read();
        if (done) break;

        // Stream directly to browser WebCodecs decoder (Zero disk I/O, zero recording overhead)
        if (value.type === 'configuration') {
          let codec = 'avc1.42001f';
          try {
            const parsed = h264ParseConfiguration(value.data);
            codec = 'avc1.' + [parsed.profileIndex, parsed.constraintSet, parsed.levelIndex]
              .map(x => x.toString(16).padStart(2, '0')).join('');
          } catch (e: any) {
            this.logger.warn('Failed parsing SPS/PPS configuration, using default codec:', e.message);
          }

          const rawConfigBase64 = Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength).toString('base64');
          session.broadcaster.broadcastConfig(codec, rawConfigBase64);
        } else if (value.type === 'data') {
          const pts = value.pts !== undefined ? BigInt(value.pts) : 0n;
          session.broadcaster.broadcastVideoFrame(!!value.keyframe, pts, value.data);
        }
      }
    } catch (err: any) {
      this.logger.error(`Broadcast stream error for ${session.sessionId}:`, err?.message || err);
    } finally {
      session.broadcastActive = false;
      try {
        reader.releaseLock();
      } catch (_) {}
      this.logger.info(`Broadcast loop finished for ${session.sessionId}`);
      await this.terminateClientSession(session);
    }
  }

  private resetIdleTimer(session: ActiveClientSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    session.idleTimer = setTimeout(async () => {
      this.logger.info(`Session ${session.sessionId} reached idle timeout (${config.idleTimeoutMs / 1000}s). Automatically releasing resources...`);
      await this.terminateClientSession(session);
    }, config.idleTimeoutMs);
  }

  private async terminateClientSession(session: ActiveClientSession): Promise<void> {
    session.broadcastActive = false;

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }

    if (session.kioskWatchdogInterval) {
      clearInterval(session.kioskWatchdogInterval);
      session.kioskWatchdogInterval = undefined;
    }

    if (session.reader) {
      try {
        session.reader.releaseLock();
      } catch (_) {}
    }

    // Close scrcpy session
    try {
      await session.scrcpySession.close();
    } catch (err: any) {
      this.logger.warn(`Failed closing scrcpy session: ${err.message}`);
    }

    // Release device back to pool deterministically (Zero leak guarantee)
    try {
      await this.devicePool.releaseDevice(session.deviceSerial);
    } catch (err: any) {
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
        }));
        setTimeout(() => {
          try {
            if (session.socket.readyState === 1) {
              session.socket.close();
            }
          } catch (_) {}
        }, 1000);
      }
    } catch (_) {}

    this.sessions.delete(session.clientId);
    this.logger.info(`Session ${endedSessionId} cleanly terminated and all resources freed.`);
  }

  async terminateAll(): Promise<void> {
    this.logger.info(`Terminating all active sessions (${this.sessions.size})...`);
    for (const [, session] of this.sessions) {
      await this.terminateClientSession(session);
    }
  }

  getActiveSessions(): DeviceSession[] {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.sessionId,
      deviceSerial: s.deviceSerial,
      deviceModel: s.deviceModel,
      resolution: s.resolution,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      status: SessionStatus.ACTIVE,
    }));
  }

  getActiveSession(): DeviceSession | null {
    const list = this.getActiveSessions();
    return list.length > 0 ? list[0] : null;
  }
}
