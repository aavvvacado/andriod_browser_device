import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import '../../../session/domain/repositories/session_repository.dart';

// Events
abstract class LatencyEvent extends Equatable {
  const LatencyEvent();
  @override
  List<Object?> get props => [];
}

class StartPingLoopEvent extends LatencyEvent {}
class StopPingLoopEvent extends LatencyEvent {}

class PongReceivedEvent extends LatencyEvent {
  final int rttMs;
  const PongReceivedEvent(this.rttMs);
  @override
  List<Object?> get props => [rttMs];
}

class FrameRenderedEvent extends LatencyEvent {}

// State
class LatencyState extends Equatable {
  final int rttMs;
  final int fps;
  final int minRtt;
  final int maxRtt;

  const LatencyState({
    this.rttMs = 0,
    this.fps = 0,
    this.minRtt = 0,
    this.maxRtt = 0,
  });

  LatencyState copyWith({
    int? rttMs,
    int? fps,
    int? minRtt,
    int? maxRtt,
  }) {
    return LatencyState(
      rttMs: rttMs ?? this.rttMs,
      fps: fps ?? this.fps,
      minRtt: minRtt ?? this.minRtt,
      maxRtt: maxRtt ?? this.maxRtt,
    );
  }

  @override
  List<Object?> get props => [rttMs, fps, minRtt, maxRtt];
}

// BLoC
class LatencyBloc extends Bloc<LatencyEvent, LatencyState> {
  final ISessionRepository repository;
  Timer? _pingTimer;
  StreamSubscription? _sub;

  int _framesInLastSecond = 0;
  DateTime _lastFpsTime = DateTime.now();

  LatencyBloc({required this.repository}) : super(const LatencyState()) {
    on<StartPingLoopEvent>(_onStartPingLoop);
    on<StopPingLoopEvent>(_onStopPingLoop);
    on<PongReceivedEvent>(_onPongReceived);
    on<FrameRenderedEvent>(_onFrameRendered);

    _sub = repository.incomingStream.listen((data) {
      if (data is Map<String, dynamic> && data['type'] == 'pong') {
        final double clientTime = (data['clientTime'] as num).toDouble();
        final now = DateTime.now().millisecondsSinceEpoch.toDouble();
        // Fallback or compute
        final rtt = (now - clientTime).round().clamp(1, 9999);
        add(PongReceivedEvent(rtt));
      }
    });
  }

  void _onStartPingLoop(StartPingLoopEvent event, Emitter<LatencyState> emit) {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (repository.isConnected) {
        repository.sendPing(DateTime.now().millisecondsSinceEpoch.toDouble());
      }
    });
  }

  void _onStopPingLoop(StopPingLoopEvent event, Emitter<LatencyState> emit) {
    _pingTimer?.cancel();
    _pingTimer = null;
  }

  void _onPongReceived(PongReceivedEvent event, Emitter<LatencyState> emit) {
    final minRtt = state.minRtt == 0 ? event.rttMs : (event.rttMs < state.minRtt ? event.rttMs : state.minRtt);
    final maxRtt = event.rttMs > state.maxRtt ? event.rttMs : state.maxRtt;
    emit(state.copyWith(rttMs: event.rttMs, minRtt: minRtt, maxRtt: maxRtt));
  }

  void _onFrameRendered(FrameRenderedEvent event, Emitter<LatencyState> emit) {
    _framesInLastSecond++;
    final now = DateTime.now();
    final elapsed = now.difference(_lastFpsTime).inMilliseconds;
    if (elapsed >= 1000) {
      final fps = ((_framesInLastSecond * 1000) / elapsed).round();
      _framesInLastSecond = 0;
      _lastFpsTime = now;
      emit(state.copyWith(fps: fps));
    }
  }

  @override
  Future<void> close() {
    _pingTimer?.cancel();
    _sub?.cancel();
    return super.close();
  }
}
