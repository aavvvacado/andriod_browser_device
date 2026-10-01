"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdbDevicePoolAdapter = void 0;
const adb_1 = require("@yume-chan/adb");
const adb_server_node_tcp_1 = require("@yume-chan/adb-server-node-tcp");
const logger_js_1 = require("../../core/logger.js");
const config_js_1 = require("../../core/config.js");
class AdbDevicePoolAdapter {
    logger = new logger_js_1.Logger('AdbDevicePoolAdapter');
    client;
    leasedDevices = new Set();
    constructor() {
        const connector = new adb_server_node_tcp_1.AdbServerNodeTcpConnector({ host: config_js_1.config.adbHost, port: config_js_1.config.adbPort });
        this.client = new adb_1.AdbServerClient(connector);
    }
    async getAvailableDevices() {
        try {
            const devices = await this.client.getDevices();
            return devices.map(d => ({
                serial: d.serial,
                model: d.model || d.product || 'Android Device',
                product: d.product || 'generic',
                isAvailable: !this.leasedDevices.has(d.serial),
            }));
        }
        catch (err) {
            this.logger.error('Failed to list devices from ADB', err);
            return [];
        }
    }
    async leaseDevice(preferredSerial) {
        const devices = await this.getAvailableDevices();
        if (devices.length === 0) {
            throw new Error('No Android devices connected via ADB');
        }
        let target;
        if (preferredSerial) {
            target = devices.find(d => d.serial === preferredSerial && d.isAvailable);
        }
        if (!target) {
            target = devices.find(d => d.isAvailable);
        }
        if (!target) {
            throw new Error(`Device pool capacity reached (${this.leasedDevices.size}/${config_js_1.config.maxSessions} active sessions). All Android devices are currently leased.`);
        }
        this.leasedDevices.add(target.serial);
        this.logger.info(`Leased dedicated device ${target.model} (${target.serial}). Active leases: ${this.leasedDevices.size}`);
        return target;
    }
    async releaseDevice(serial) {
        this.leasedDevices.delete(serial);
        this.logger.info(`Released device ${serial}. Active leases: ${this.leasedDevices.size}`);
    }
    getActiveLeaseCount() {
        return this.leasedDevices.size;
    }
    async createAdbTransport(serial) {
        const devices = await this.client.getDevices();
        const dev = devices.find(d => d.serial === serial);
        if (!dev) {
            throw new Error(`Device ${serial} not found in ADB`);
        }
        const transport = await this.client.createTransport(dev);
        return new adb_1.Adb(transport);
    }
}
exports.AdbDevicePoolAdapter = AdbDevicePoolAdapter;
