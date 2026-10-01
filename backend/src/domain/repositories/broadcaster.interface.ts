export interface IStreamBroadcaster {
  broadcastConfig(codec: string, rawConfigBase64: string): void;
  broadcastVideoFrame(isKeyframe: boolean, pts: bigint, data: Uint8Array): void;
  sendTo(clientId: string, data: string | Buffer): void;
  registerClient(clientId: string, socket: any): void;
  unregisterClient(clientId: string): void;
  getClientCount(): number;
}
