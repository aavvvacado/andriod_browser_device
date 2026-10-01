import { AdbServerClient, Adb } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { IDevicePoolRepository } from '../../domain/repositories/device-pool.repository.js';
import { DeviceInfo } from '../../domain/entities/device.js';
import { Logger } from '../../core/logger.js';
import { config } from '../../core/config.js';

export class AdbDevicePoolAdapter implements IDevicePoolRepository {
  private logger = new Logger('AdbDevicePoolAdapter');
  private client: AdbServerClient;
  private leasedDevices: Set<string> = new Set();

  constructor() {
    const connector = new AdbServerNodeTcpConnector({ host: config.adbHost, port: config.adbPort });
    this.client = new AdbServerClient(connector);
  }

  async getAvailableDevices(): Promise<DeviceInfo[]> {
    try {
      const devices = await this.client.getDevices();
      return devices.map(d => ({
        serial: d.serial,
        model: d.model || d.product || 'Android Device',
        product: d.product || 'generic',
        isAvailable: !this.leasedDevices.has(d.serial),
      }));
    } catch (err: any) {
      this.logger.error('Failed to list devices from ADB', err);
      return [];
    }
  }

  async leaseDevice(preferredSerial?: string): Promise<DeviceInfo> {
    const devices = await this.getAvailableDevices();
    if (devices.length === 0) {
      throw new Error('No Android devices connected via ADB');
    }

    let target: DeviceInfo | undefined;
    if (preferredSerial) {
      target = devices.find(d => d.serial === preferredSerial && d.isAvailable);
    }
    if (!target) {
      target = devices.find(d => d.isAvailable);
    }

    if (!target) {
      throw new Error(`Device pool capacity reached (${this.leasedDevices.size}/${config.maxSessions} active sessions). All Android devices are currently leased.`);
    }

    this.leasedDevices.add(target.serial);
    this.logger.info(`Leased dedicated device ${target.model} (${target.serial}). Active leases: ${this.leasedDevices.size}`);
    return target;
  }

  async releaseDevice(serial: string): Promise<void> {
    this.leasedDevices.delete(serial);
    this.logger.info(`Released device ${serial}. Active leases: ${this.leasedDevices.size}`);
  }

  getActiveLeaseCount(): number {
    return this.leasedDevices.size;
  }

  async createAdbTransport(serial: string): Promise<Adb> {
    const devices = await this.client.getDevices();
    const dev = devices.find(d => d.serial === serial);
    if (!dev) {
      throw new Error(`Device ${serial} not found in ADB`);
    }
    const transport = await this.client.createTransport(dev);
    return new Adb(transport);
  }
}
