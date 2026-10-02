
abstract class ISessionRepository {
  Stream<dynamic> get incomingStream;
  Map<String, dynamic>? get latestConfig;
  Future<void> connect(String wsUrl);
  Future<void> disconnect();
  void sendJson(Map<String, dynamic> json);
  void sendTouch({
    required String action,
    required double x,
    required double y,
    double? screenWidth,
    double? screenHeight,
  });
  void sendScroll({
    required double x,
    required double y,
    required double distanceX,
    required double distanceY,
    double? screenWidth,
    double? screenHeight,
  });
  void sendKey(String keyName);
  void sendText(String text);
  void sendClipboard(String text);
  void sendKioskToggle({required bool enabled, String? package});
  void sendPing(double clientTime);
  void sendStopSession();
  bool get isConnected;
}

