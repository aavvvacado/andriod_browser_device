import { DeviceInfo } from '../entities/device.js';

export interface IDevicePoolRepository {
  getAvailableDevices(): Promise<DeviceInfo[]>;
  leaseDevice(preferredSerial?: string): Promise<DeviceInfo>;
  releaseDevice(serial: string): Promise<void>;
  getActiveLeaseCount(): number;
}
