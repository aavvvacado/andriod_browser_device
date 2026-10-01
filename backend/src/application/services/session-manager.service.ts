import { h264ParseConfiguration } from '@yume-chan/scrcpy';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IDevicePoolRepository } from '../../domain/repositories/device-pool.repository.js';
import { IScrcpyManager, IScrcpySession, ScrcpyPacket } from '../../domain/repositories/scrcpy.interface.js';
import { DeviceSession, SessionStatus } from '../../domain/entities/session.js';
import { ClientInputEvent } from '../../domain/entities/input-event.js';
import { WebSocketStreamBroadcaster } from '../../infrastructure/websocket/websocket-broadcaster.adapter.js';
import { SessionRecorder } from '../../infrastructure/recording/session-recorder.service.js';
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
  recorder: SessionRecorder;
  socket: any;
  createdAt: number;
  lastActivityAt: number;
  resolution: { width: number; height: number };
  kioskEnabled: boolean;
  kioskPackage: string;
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

  private async detectDeviceCalculator(serial: string): Promise<string> {
    const candidates = [
      'com.google.android.calculator',
      'com.android.calculator2',
      'com.android.calculator',
      'com.sec.android.app.popupcalculator',
    ];

    try {
      const { stdout } = await execAsync(`adb -s ${serial} shell "pm list packages | grep -i calculator || true"`);
      const installed = stdout
        .split('\n')
        .map(line => line.trim().replace(/^package:/, ''))
        .filter(Boolean);

      for (const candidate of candidates) {
        if (installed.includes(candidate)) {
          this.logger.info(`Detected calculator package on ${serial}: ${candidate}`);
          return candidate;
        }
      }

      if (installed.length > 0) {
        this.logger.info(`Detected generic calculator package on ${serial}: ${installed[0]}`);
        return installed[0];
      }
    } catch (err: any) {
      this.logger.warn(`Failed detecting calculator package on ${serial}, falling back to default: ${err.message}`);
    }

    return 'com.android.calculator2';
  }

  async handleClientConnected(clientId: string, socket: any, clientToken: string = ''): Promise<DeviceSession> {
    this.logger.info(`Starting dedicated on-demand session for client: ${clientId} (token: ${clientToken})...`);

    // 1. Lease dedicated isolated device from pool
    const device = await this.devicePool.leaseDevice();

    // 2. Start dedicated scrcpy session for this device
    const scrcpySession = await this.scrcpyManager.startSession(device.serial);

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const broadcaster = new WebSocketStreamBroadcaster();
    const recorder = new SessionRecorder(sessionId, device.serial, device.model, clientToken);

    // Detect installed calculator package dynamically
    const detectedKioskPackage = await this.detectDeviceCalculator(device.serial);

    const session: ActiveClientSession = {
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
      kioskPackage: detectedKioskPackage,
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

    // 4. Send init packet FIRST to client with dynamic calculator package info
    socket.send(JSON.stringify({
      type: 'init',
      sessionId: session.sessionId,
      deviceModel: session.deviceModel,
      width: session.resolution.width,
      height: session.resolution.height,
      kioskPackage: session.kioskPackage,
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

        case 'save_recording': {
          const targetId = event.sessionId || session.sessionId;
          this.logger.info(`Client ${clientId} saved recording for ${targetId}`);
          SessionRecorder.saveRecording(targetId);
          if (session.socket.readyState === 1) {
            session.socket.send(JSON.stringify({ type: 'recording_saved', sessionId: targetId }));
          }
          break;
        }

        case 'delete_recording': {
          const targetId = event.sessionId || session.sessionId;
          this.logger.info(`Client ${clientId} requested deletion of recording for ${targetId}`);
          SessionRecorder.deleteRecording(targetId);
          if (session.socket.readyState === 1) {
            session.socket.send(JSON.stringify({ type: 'recording_deleted', sessionId: targetId }));
          }
          break;
        }
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
      } catch (err: any) {
        this.logger.warn(`Failed launching kiosk app: ${err.message}`);
      }

      // Start Server-Side Kiosk Watchdog (Checks every 3s that user stays inside the app)
      session.kioskWatchdogInterval = setInterval(async () => {
        if (!session.kioskEnabled) return;
        try {
          const { stdout } = await execAsync(`adb -s ${session.deviceSerial} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true"`);
          if (!stdout.includes(session.kioskPackage) && !stdout.includes('PopupWindow')) {
            this.logger.warn(`[Kiosk Security Watchdog] Unauthorized activity detected! Refocusing ${session.kioskPackage}...`);
            await execAsync(`adb -s ${session.deviceSerial} shell monkey -p ${session.kioskPackage} -c android.intent.category.LAUNCHER 1`);
          }
        } catch (_) {}
      }, 3000);
    } else {
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

  private async startBroadcastLoop(
    session: ActiveClientSession,
    reader: ReadableStreamDefaultReader<ScrcpyPacket>
  ): Promise<void> {
    this.logger.info(`Broadcast loop started for session ${session.sessionId}`);

    try {
      while (session.broadcastActive) {
        const { done, value } = await reader.read();
        if (done) break;

        // 1. Write packet to automatic session recorder (Bonus 5)
        session.recorder.writePacket(value.data);

        // 2. Stream to browser WebCodecs decoder
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

    // Stop and finalize session recording into MP4 container (Bonus 5)
    try {
      await session.recorder.stop();
    } catch (err: any) {
      this.logger.warn(`Failed cleanly stopping recorder: ${err.message}`);
    }

    // Close scrcpy session
    try {
      await session.scrcpySession.close();
    } catch (err: any) {
      this.logger.warn(`Failed closing scrcpy session: ${err.message}`);
    }

    // Release device back to pool (Bonus 1 & 2)
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
          recordingUrl: `/api/recordings/${endedSessionId}`,
        }));
        // Give client a moment to receive the message before closing socket
        setTimeout(() => {
          try {
            if (session.socket.readyState === 1) {
              session.socket.close();
            }
          } catch (_) {}
        }, 3000);
      }
    } catch (_) {}

    // Auto-prune unsaved recording if session closed abandoned
    // If the recording is not saved within 60 seconds, delete it to prevent filling disk
    setTimeout(() => {
      const meta = SessionRecorder.getMetadata(endedSessionId);
      if (meta && meta.saved !== true) {
        this.logger.info(`Auto-pruning unsaved recording for ended session ${endedSessionId} to protect disk space`);
        SessionRecorder.deleteRecording(endedSessionId);
      }
    }, 60000);

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
