import { TouchInputEvent, KeyInputEvent, TextInputEvent, ScrollInputEvent } from '../entities/input-event.js';

export interface ScrcpyStreamMetadata {
  deviceName: string;
  width: number;
  height: number;
  codec: number;
}

export interface ScrcpyPacket {
  type: 'configuration' | 'data';
  keyframe?: boolean;
  pts?: bigint;
  data: Uint8Array;
}

export interface IScrcpySession {
  metadata: ScrcpyStreamMetadata;
  getPacketReader(): ReadableStreamDefaultReader<ScrcpyPacket>;
  injectTouch(event: TouchInputEvent): Promise<void>;
  injectKey(event: KeyInputEvent): Promise<void>;
  injectText(event: TextInputEvent): Promise<void>;
  injectScroll(event: ScrollInputEvent): Promise<void>;
  setClipboard(text: string): Promise<void>;
  setOnClipboard(callback: (text: string) => void): void;
  setKioskMode(enabled: boolean, allowedPackage?: string): void;
  isKioskMode(): boolean;
  close(): Promise<void>;
}

export interface IScrcpyManager {
  startSession(serial: string): Promise<IScrcpySession>;
}

