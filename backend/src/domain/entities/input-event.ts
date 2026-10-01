export type TouchAction = 'down' | 'move' | 'up';

export interface TouchInputEvent {
  type: 'touch';
  action: TouchAction;
  x: number;
  y: number;
  screenWidth?: number;
  screenHeight?: number;
  pointerId?: number;
  pressure?: number;
}

export type KeyName =
  | 'Home'
  | 'Back'
  | 'Recents'
  | 'AppSwitch'
  | 'Power'
  | 'VolumeUp'
  | 'VolumeDown'
  | 'Enter'
  | 'Backspace'
  | 'Tab'
  | 'Escape'
  | 'Delete'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight';

export interface KeyInputEvent {
  type: 'key';
  key: KeyName;
}

export interface TextInputEvent {
  type: 'text';
  text: string;
}

export interface ScrollInputEvent {
  type: 'scroll';
  x: number;
  y: number;
  distanceX: number;
  distanceY: number;
  screenWidth?: number;
  screenHeight?: number;
}

export interface ClipboardInputEvent {
  type: 'clipboard';
  text: string;
}

export interface KioskToggleEvent {
  type: 'kiosk_toggle';
  enabled: boolean;
  package?: string;
}

export interface PingEvent {
  type: 'ping';
  clientTime: number;
}

export type ClientInputEvent =
  | TouchInputEvent
  | KeyInputEvent
  | TextInputEvent
  | ScrollInputEvent
  | ClipboardInputEvent
  | KioskToggleEvent
  | PingEvent;

