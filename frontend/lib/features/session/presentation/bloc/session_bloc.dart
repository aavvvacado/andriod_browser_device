import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import '../../domain/entities/device_session.dart';
import '../../domain/repositories/session_repository.dart';

// Events
abstract class SessionEvent extends Equatable {
  const SessionEvent();
  @override
  List<Object?> get props => [];
}

class ConnectSessionEvent extends SessionEvent {
  final String url;
  const ConnectSessionEvent(this.url);
  @override
  List<Object?> get props => [url];
}

class DisconnectSessionEvent extends SessionEvent {}

class SessionPacketReceivedEvent extends SessionEvent {
  final dynamic packet;
  const SessionPacketReceivedEvent(this.packet);
  @override
  List<Object?> get props => [packet];
}

// States
abstract class SessionState extends Equatable {
  const SessionState();
  @override
  List<Object?> get props => [];
}

class SessionInitial extends SessionState {}

class SessionConnecting extends SessionState {}

class SessionConnected extends SessionState {
  final DeviceMetadata metadata;
  final SessionConfig? config;

  const SessionConnected({
    required this.metadata,
    this.config,
  });

  SessionConnected copyWith({
    DeviceMetadata? metadata,
    SessionConfig? config,
  }) {
    return SessionConnected(
      metadata: metadata ?? this.metadata,
      config: config ?? this.config,
    );
  }

  @override
  List<Object?> get props => [metadata, config];
}

class SessionDisconnected extends SessionState {
  final String reason;
  const SessionDisconnected({this.reason = 'Disconnected from server'});
  @override
  List<Object?> get props => [reason];
}

class SessionError extends SessionState {
  final String message;
  const SessionError(this.message);
  @override
  List<Object?> get props => [message];
}

// BLoC
class SessionBloc extends Bloc<SessionEvent, SessionState> {
  final ISessionRepository repository;
  StreamSubscription? _subscription;

  SessionBloc({required this.repository}) : super(SessionInitial()) {
    on<ConnectSessionEvent>(_onConnect);
    on<DisconnectSessionEvent>(_onDisconnect);
    on<SessionPacketReceivedEvent>(_onPacketReceived);
  }

  Future<void> _onConnect(ConnectSessionEvent event, Emitter<SessionState> emit) async {
    emit(SessionConnecting());
    try {
      await repository.connect(event.url);
      await _subscription?.cancel();
      _subscription = repository.incomingStream.listen((data) {
        add(SessionPacketReceivedEvent(data));
      });
    } catch (err) {
      emit(SessionError(err.toString()));
    }
  }

  Future<void> _onDisconnect(DisconnectSessionEvent event, Emitter<SessionState> emit) async {
    await _subscription?.cancel();
    await repository.disconnect();
    emit(const SessionDisconnected(reason: 'User disconnected'));
  }

  void _onPacketReceived(SessionPacketReceivedEvent event, Emitter<SessionState> emit) {
    final data = event.packet;

    if (data is Map<String, dynamic>) {
      final type = data['type'];
      if (type == 'init') {
        final metadata = DeviceMetadata(
          model: data['model'] ?? data['deviceModel'] ?? 'Android Device',
          width: data['width'] ?? 0,
          height: data['height'] ?? 0,
        );

        if (state is SessionConnected) {
          emit((state as SessionConnected).copyWith(metadata: metadata));
        } else {
          emit(SessionConnected(metadata: metadata));
        }
      } else if (type == 'config') {
        final codec = data['codec'] ?? 'avc1.42001f';
        final rawConfigBase64 = data['rawConfig'] ?? '';
        final config = SessionConfig(
          codec: codec,
          rawConfig: rawConfigBase64.isNotEmpty ? rawConfigBase64.codeUnits : [],
        );

        if (state is SessionConnected) {
          emit((state as SessionConnected).copyWith(config: config));
        }
      } else if (type == 'closed') {
        emit(SessionDisconnected(reason: data['reason'] ?? 'Connection closed'));
      } else if (type == 'error') {
        emit(SessionError(data['message'] ?? 'Server error'));
      }
    }
  }

  @override
  Future<void> close() {
    _subscription?.cancel();
    return super.close();
  }
}
