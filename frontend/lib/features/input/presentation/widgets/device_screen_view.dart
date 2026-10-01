import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';
import 'dart:ui_web' as ui_web;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:web/web.dart' as web;
import '../../../session/domain/entities/device_session.dart';
import '../../../session/domain/repositories/session_repository.dart';
import '../../../latency/presentation/bloc/latency_bloc.dart';
import '../bloc/input_bloc.dart';
import '../../../../core/theme/app_theme.dart';

class DeviceScreenView extends StatefulWidget {
  final DeviceMetadata metadata;

  const DeviceScreenView({super.key, required this.metadata});

  @override
  State<DeviceScreenView> createState() => _DeviceScreenViewState();
}

class _DeviceScreenViewState extends State<DeviceScreenView> {
  static const String viewType = 'android-device-canvas';
  static bool _factoryRegistered = false;

  late final web.HTMLCanvasElement _canvas;
  late final web.CanvasRenderingContext2D _ctx;
  final FocusNode _focusNode = FocusNode();
  final GlobalKey _screenKey = GlobalKey();

  StreamSubscription? _streamSub;
  web.VideoDecoder? _decoder;
  Uint8List? _configBytes;
  bool _isConfigured = false;
  bool _isFirstFrameReceived = false;
  bool _isPointerDown = false;
  web.EventListener? _pasteListener;

  @override
  void initState() {
    super.initState();
    _initCanvas();
    _initDecoder();
    _subscribeToStream();
    _initPasteListener();
  }

  void _initPasteListener() {
    try {
      _pasteListener = ((web.ClipboardEvent e) {
        final pastedText = e.clipboardData?.getData('text') ?? '';
        if (pastedText.isNotEmpty && mounted) {
          context.read<InputBloc>().add(SendClipboardEvent(pastedText));
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Pasted "${pastedText.length > 20 ? '${pastedText.substring(0, 20)}...' : pastedText}" to Android'),
              duration: const Duration(seconds: 1),
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      }).toJS as web.EventListener;
      web.window.addEventListener('paste', _pasteListener);
    } catch (_) {}
  }

  void _initCanvas() {
    _canvas = web.document.createElement('canvas') as web.HTMLCanvasElement;
    _canvas.id = 'flutterDeviceScreen';
    _canvas.width = widget.metadata.width > 0 ? widget.metadata.width : 1080;
    _canvas.height = widget.metadata.height > 0 ? widget.metadata.height : 2408;
    _canvas.style.width = '100%';
    _canvas.style.height = '100%';
    _canvas.style.display = 'block';
    _canvas.style.objectFit = 'contain';
    _canvas.style.touchAction = 'none';
    _canvas.style.cursor = 'default';
    _canvas.style.userSelect = 'none';
    _canvas.style.pointerEvents = 'none'; // Pass all pointer events to Flutter's Listener overlay
    _canvas.tabIndex = -1;

    _ctx = _canvas.getContext('2d') as web.CanvasRenderingContext2D;

    // Suppress context menu globally on the element
    _canvas.oncontextmenu = (web.MouseEvent e) {
      e.preventDefault();
    }.toJS;

    if (!_factoryRegistered) {
      ui_web.platformViewRegistry.registerViewFactory(viewType, (int viewId) => _canvas);
      _factoryRegistered = true;
    }
  }

  void _dispatchTouchEvent(String action, Offset localPos) {
    final RenderBox? box = _screenKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || box.size.width <= 0 || box.size.height <= 0) return;

    final double videoWidth = widget.metadata.width > 0 ? widget.metadata.width.toDouble() : 1080.0;
    final double videoHeight = widget.metadata.height > 0 ? widget.metadata.height.toDouble() : 2408.0;

    final double normX = (localPos.dx * (videoWidth / box.size.width)).clamp(0.0, videoWidth);
    final double normY = (localPos.dy * (videoHeight / box.size.height)).clamp(0.0, videoHeight);

    context.read<InputBloc>().add(SendTouchEvent(
      action: action,
      x: normX,
      y: normY,
      screenWidth: videoWidth,
      screenHeight: videoHeight,
    ));
  }

  void _dispatchScrollEvent(Offset localPos, double dx, double dy) {
    final RenderBox? box = _screenKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || box.size.width <= 0 || box.size.height <= 0) return;

    final double videoWidth = widget.metadata.width > 0 ? widget.metadata.width.toDouble() : 1080.0;
    final double videoHeight = widget.metadata.height > 0 ? widget.metadata.height.toDouble() : 2408.0;

    final double normX = (localPos.dx * (videoWidth / box.size.width)).clamp(0.0, videoWidth);
    final double normY = (localPos.dy * (videoHeight / box.size.height)).clamp(0.0, videoHeight);

    context.read<InputBloc>().add(SendScrollEvent(
      x: normX,
      y: normY,
      distanceX: dx,
      distanceY: dy,
      screenWidth: videoWidth,
      screenHeight: videoHeight,
    ));
  }

  void _readAndSendClipboard() async {
    try {
      final textJS = await web.window.navigator.clipboard.readText().toDart;
      final text = textJS.toDart;
      if (text.isNotEmpty && mounted) {
        context.read<InputBloc>().add(SendClipboardEvent(text));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Pasted "${text.length > 20 ? '${text.substring(0, 20)}...' : text}" to Android'),
            duration: const Duration(seconds: 1),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (_) {}
  }

  void _initDecoder() {
    final init = web.VideoDecoderInit(
      output: (web.VideoFrame frame) {
        if (!_isFirstFrameReceived) {
          setState(() {
            _isFirstFrameReceived = true;
          });
        }

        // Only update dimensions when resolution actually changes to prevent context clears
        if (_canvas.width != frame.displayWidth || _canvas.height != frame.displayHeight) {
          _canvas.width = frame.displayWidth;
          _canvas.height = frame.displayHeight;
        }

        _ctx.drawImage(frame, 0, 0);
        frame.close();

        if (mounted) {
          context.read<LatencyBloc>().add(FrameRenderedEvent());
        }
      }.toJS,
      error: (web.DOMException err) {
        // Log or handle decode error
      }.toJS,
    );

    _decoder = web.VideoDecoder(init);
  }

  void _subscribeToStream() {
    final repository = context.read<ISessionRepository>();

    if (repository.latestConfig != null) {
      _handleConfigMessage(repository.latestConfig!);
    }

    _streamSub = repository.incomingStream.listen((packet) {
      if (packet is Map<String, dynamic>) {
        if (packet['type'] == 'config') {
          _handleConfigMessage(packet);
        } else if (packet['type'] == 'clipboard') {
          final text = packet['text'] as String?;
          if (text != null && text.isNotEmpty) {
            try {
              web.window.navigator.clipboard.writeText(text);
            } catch (_) {}
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Android clipboard copied: "$text"'),
                  action: SnackBarAction(
                    label: 'Copy',
                    textColor: AppTheme.primaryLight,
                    onPressed: () {
                      try {
                        web.window.navigator.clipboard.writeText(text);
                      } catch (_) {}
                    },
                  ),
                  duration: const Duration(seconds: 3),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            }
          }
        }
      } else if (packet is ByteBuffer) {
        _handleBinaryPacket(packet);
      }
    });
  }

  void _handleConfigMessage(Map<String, dynamic> msg) {
    final codec = (msg['codec'] as String?) ?? 'avc1.42001f';
    final rawBase64 = (msg['rawConfig'] as String?) ?? '';

    if (rawBase64.isNotEmpty) {
      _configBytes = base64Decode(rawBase64);
      _isConfigured = false;

      final config = web.VideoDecoderConfig(
        codec: codec,
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
      );

      try {
        _decoder?.configure(config);
      } catch (_) {}
    }
  }

  void _handleBinaryPacket(ByteBuffer buffer) {
    if (_decoder == null || _decoder!.state != 'configured') return;

    final view = ByteData.view(buffer);
    final packetType = view.getUint8(0);

    if (packetType == 2) {
      // H.264 video NAL chunk
      final isKey = view.getUint8(1) == 1;
      final rawVideo = Uint8List.view(buffer, 10);

      try {
        if (!_isConfigured) {
          if (_configBytes != null) {
            final combined = Uint8List(_configBytes!.length + rawVideo.length);
            combined.setAll(0, _configBytes!);
            combined.setAll(_configBytes!.length, rawVideo);

            final chunk = web.EncodedVideoChunk(web.EncodedVideoChunkInit(
              type: 'key',
              timestamp: 0,
              data: combined.toJS,
            ));
            _decoder!.decode(chunk);
            _isConfigured = true;
          }
        } else {
          final chunk = web.EncodedVideoChunk(web.EncodedVideoChunkInit(
            type: isKey ? 'key' : 'delta',
            timestamp: 0,
            data: rawVideo.toJS,
          ));
          _decoder!.decode(chunk);
        }
      } catch (_) {}
    }
  }

  @override
  void dispose() {
    _streamSub?.cancel();
    if (_pasteListener != null) {
      try {
        web.window.removeEventListener('paste', _pasteListener);
      } catch (_) {}
    }
    _decoder?.close();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final double aspectRatio = widget.metadata.aspectRatio;

    return Center(
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.82,
        ),
        child: AspectRatio(
          aspectRatio: aspectRatio,
          child: Focus(
            focusNode: _focusNode,
            autofocus: true,
            onKeyEvent: (FocusNode node, KeyEvent event) {
              if (event is! KeyDownEvent) return KeyEventResult.ignored;

              // Clipboard paste shortcut Ctrl+V / Cmd+V
              if ((HardwareKeyboard.instance.isControlPressed || HardwareKeyboard.instance.isMetaPressed) &&
                  event.logicalKey == LogicalKeyboardKey.keyV) {
                _readAndSendClipboard();
                return KeyEventResult.handled;
              }

              // Special Android hardware & navigation keys
              final keyMap = <LogicalKeyboardKey, String>{
                LogicalKeyboardKey.backspace: 'Backspace',
                LogicalKeyboardKey.enter: 'Enter',
                LogicalKeyboardKey.numpadEnter: 'Enter',
                LogicalKeyboardKey.tab: 'Tab',
                LogicalKeyboardKey.escape: 'Back', // Escape operates as Android Back
                LogicalKeyboardKey.delete: 'Delete',
                LogicalKeyboardKey.arrowUp: 'ArrowUp',
                LogicalKeyboardKey.arrowDown: 'ArrowDown',
                LogicalKeyboardKey.arrowLeft: 'ArrowLeft',
                LogicalKeyboardKey.arrowRight: 'ArrowRight',
              };

              if (keyMap.containsKey(event.logicalKey)) {
                context.read<InputBloc>().add(SendKeyEvent(keyMap[event.logicalKey]!));
                return KeyEventResult.handled;
              }

              // Direct printable typing into active Android app / text input
              final character = event.character;
              if (character != null &&
                  character.isNotEmpty &&
                  !HardwareKeyboard.instance.isControlPressed &&
                  !HardwareKeyboard.instance.isAltPressed &&
                  !HardwareKeyboard.instance.isMetaPressed) {
                context.read<InputBloc>().add(SendTextEvent(character));
                return KeyEventResult.handled;
              }

              return KeyEventResult.ignored;
            },
            child: Container(
              decoration: BoxDecoration(
                color: Colors.black,
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: AppTheme.surfaceLight, width: 4),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.7),
                    blurRadius: 30,
                    offset: const Offset(0, 15),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  // Live Screen HTML5 Canvas
                  const HtmlElementView(viewType: viewType),

                  // Transparent, fully interactive pointer listener directly over the mirrored screen
                  Positioned.fill(
                    child: Listener(
                      key: _screenKey,
                      behavior: HitTestBehavior.opaque,
                      onPointerDown: (PointerDownEvent event) {
                        _focusNode.requestFocus();
                        if (event.buttons & 1 != 0) { // Primary / Left Click / Touch
                          _isPointerDown = true;
                          _dispatchTouchEvent('down', event.localPosition);
                        } else if (event.buttons & 2 != 0) { // Right Click -> Android Back
                          context.read<InputBloc>().add(const SendKeyEvent('Back'));
                        }
                      },
                      onPointerMove: (PointerMoveEvent event) {
                        if (_isPointerDown) {
                          _dispatchTouchEvent('move', event.localPosition);
                        }
                      },
                      onPointerUp: (PointerUpEvent event) {
                        if (_isPointerDown) {
                          _isPointerDown = false;
                          _dispatchTouchEvent('up', event.localPosition);
                        }
                      },
                      onPointerCancel: (PointerCancelEvent event) {
                        if (_isPointerDown) {
                          _isPointerDown = false;
                          _dispatchTouchEvent('up', event.localPosition);
                        }
                      },
                      onPointerSignal: (PointerSignalEvent event) {
                        if (event is PointerScrollEvent) {
                          _dispatchScrollEvent(
                            event.localPosition,
                            event.scrollDelta.dx,
                            event.scrollDelta.dy,
                          );
                        }
                      },
                      child: const SizedBox.expand(),
                    ),
                  ),

                  // Initial loading overlay until first video frame is received
                  if (!_isFirstFrameReceived)
                    Container(
                      color: AppTheme.background.withValues(alpha: 0.9),
                      child: const Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            CircularProgressIndicator(color: AppTheme.primaryLight),
                            SizedBox(height: 16),
                            Text('Receiving Live Stream...', style: TextStyle(color: Colors.white70)),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
