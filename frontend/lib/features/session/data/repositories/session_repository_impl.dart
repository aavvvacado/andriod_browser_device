import 'dart:async';
import '../../domain/repositories/session_repository.dart';
import '../datasources/session_websocket_datasource.dart';

class SessionRepositoryImpl implements ISessionRepository {
  final SessionWebSocketDataSource dataSource;

  SessionRepositoryImpl({required this.dataSource});

  @override
  Stream<dynamic> get incomingStream => dataSource.stream;

  @override
  Map<String, dynamic>? get latestConfig => dataSource.latestConfig;

  @override
  bool get isConnected => dataSource.isConnected;

  @override
  Future<void> connect(String wsUrl) async {
    await dataSource.connect(wsUrl);
  }

  @override
  Future<void> disconnect() async {
    await dataSource.disconnect();
  }

  @override
  void sendJson(Map<String, dynamic> json) {
    dataSource.send(json);
  }

  @override
  void sendTouch({
    required String action,
    required double x,
    required double y,
    double? screenWidth,
    double? screenHeight,
  }) {
    sendJson({
      'type': 'touch',
      'action': action,
      'x': x,
      'y': y,
      'screenWidth': ?screenWidth,
      'screenHeight': ?screenHeight,
    });
  }

  @override
  void sendScroll({
    required double x,
    required double y,
    required double distanceX,
    required double distanceY,
    double? screenWidth,
    double? screenHeight,
  }) {
    sendJson({
      'type': 'scroll',
      'x': x,
      'y': y,
      'distanceX': distanceX,
      'distanceY': distanceY,
      'screenWidth': ?screenWidth,
      'screenHeight': ?screenHeight,
    });
  }

  @override
  void sendKey(String keyName) {
    sendJson({
      'type': 'key',
      'key': keyName,
    });
  }

  @override
  void sendText(String text) {
    sendJson({
      'type': 'text',
      'text': text,
    });
  }

  @override
  void sendClipboard(String text) {
    sendJson({
      'type': 'clipboard',
      'text': text,
    });
  }

  @override
  void sendKioskToggle({required bool enabled, String? package}) {
    sendJson({
      'type': 'kiosk_toggle',
      'enabled': enabled,
      'package': ?package,
    });
  }

  @override
  void sendPing(double clientTime) {
    sendJson({
      'type': 'ping',
      'clientTime': clientTime,
    });
  }

  @override
  void sendStopSession() {
    sendJson({
      'type': 'stop_session',
    });
  }
}

