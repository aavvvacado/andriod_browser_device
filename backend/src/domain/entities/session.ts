export enum SessionStatus {
  STARTING = 'STARTING',
  ACTIVE = 'ACTIVE',
  IDLE = 'IDLE',
  CLOSED = 'CLOSED',
}

export interface DeviceSession {
  id: string;
  deviceSerial: string;
  deviceModel: string;
  resolution: { width: number; height: number };
  createdAt: number;
  lastActivityAt: number;
  status: SessionStatus;
}
