import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'package:web/web.dart' as web;

class SessionWebSocketDataSource {
  web.WebSocket? _socket;
  final StreamController<dynamic> _streamController = StreamController<dynamic>.broadcast();
  Map<String, dynamic>? _latestConfig;

  Stream<dynamic> get stream => _streamController.stream;
  bool get isConnected => _socket != null && _socket!.readyState == web.WebSocket.OPEN;
  Map<String, dynamic>? get latestConfig => _latestConfig;

  Future<void> connect(String url) async {
    await disconnect();

    final completer = Completer<void>();
    final ws = web.WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = (web.Event e) {
      if (!completer.isCompleted) completer.complete();
    }.toJS;

    ws.onmessage = (web.MessageEvent e) {
      final data = e.data;
      if (data.isA<JSString>()) {
        final text = (data as JSString).toDart;
        try {
          final json = jsonDecode(text);
          if (json is Map<String, dynamic> && json['type'] == 'config') {
            _latestConfig = json;
          }
          _streamController.add(json);
        } catch (_) {
          _streamController.add(text);
        }
      } else if (data.isA<JSArrayBuffer>()) {
        final buffer = (data as JSArrayBuffer).toDart;
        _streamController.add(buffer);
      }
    }.toJS;

    ws.onclose = (web.CloseEvent e) {
      _streamController.add({'type': 'closed', 'code': e.code, 'reason': e.reason});
    }.toJS;

    ws.onerror = (web.Event e) {
      if (!completer.isCompleted) {
        completer.completeError(Exception('WebSocket connection failed'));
      }
    }.toJS;

    _socket = ws;
    return completer.future.timeout(const Duration(seconds: 10));
  }

  void send(dynamic data) {
    if (!isConnected) return;
    if (data is String) {
      _socket!.send(data.toJS);
    } else if (data is Map<String, dynamic>) {
      _socket!.send(jsonEncode(data).toJS);
    }
  }

  Future<void> disconnect() async {
    if (_socket != null) {
      _socket!.close();
      _socket = null;
    }
  }

  void dispose() {
    disconnect();
    _streamController.close();
  }
}
