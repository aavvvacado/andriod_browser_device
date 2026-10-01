export interface DeviceResolution {
  width: number;
  height: number;
}

export interface DeviceInfo {
  serial: string;
  model: string;
  product: string;
  resolution?: DeviceResolution;
  isAvailable: boolean;
}
