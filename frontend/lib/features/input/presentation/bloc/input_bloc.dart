import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import '../../../session/domain/repositories/session_repository.dart';

// Events
abstract class InputEvent extends Equatable {
  const InputEvent();
  @override
  List<Object?> get props => [];
}

class SendTouchEvent extends InputEvent {
  final String action;
  final double x;
  final double y;
  final double? screenWidth;
  final double? screenHeight;

  const SendTouchEvent({
    required this.action,
    required this.x,
    required this.y,
    this.screenWidth,
    this.screenHeight,
  });

  @override
  List<Object?> get props => [action, x, y, screenWidth, screenHeight];
}

class SendKeyEvent extends InputEvent {
  final String keyName;
  const SendKeyEvent(this.keyName);
  @override
  List<Object?> get props => [keyName];
}

class SendTextEvent extends InputEvent {
  final String text;
  const SendTextEvent(this.text);
  @override
  List<Object?> get props => [text];
}

class SendScrollEvent extends InputEvent {
  final double x;
  final double y;
  final double distanceX;
  final double distanceY;
  final double? screenWidth;
  final double? screenHeight;

  const SendScrollEvent({
    required this.x,
    required this.y,
    required this.distanceX,
    required this.distanceY,
    this.screenWidth,
    this.screenHeight,
  });

  @override
  List<Object?> get props => [x, y, distanceX, distanceY, screenWidth, screenHeight];
}

class SendClipboardEvent extends InputEvent {
  final String text;
  const SendClipboardEvent(this.text);
  @override
  List<Object?> get props => [text];
}

class SendKioskToggleEvent extends InputEvent {
  final bool enabled;
  final String? package;
  const SendKioskToggleEvent({required this.enabled, this.package});
  @override
  List<Object?> get props => [enabled, package];
}

// State
class InputState extends Equatable {
  final bool isKioskMode;
  final String? kioskPackage;

  const InputState({this.isKioskMode = false, this.kioskPackage});

  InputState copyWith({bool? isKioskMode, String? kioskPackage}) {
    return InputState(
      isKioskMode: isKioskMode ?? this.isKioskMode,
      kioskPackage: kioskPackage ?? this.kioskPackage,
    );
  }

  @override
  List<Object?> get props => [isKioskMode, kioskPackage];
}

// BLoC
class InputBloc extends Bloc<InputEvent, InputState> {
  final ISessionRepository repository;

  InputBloc({required this.repository}) : super(const InputState()) {
    on<SendTouchEvent>((event, emit) {
      repository.sendTouch(
        action: event.action,
        x: event.x,
        y: event.y,
        screenWidth: event.screenWidth,
        screenHeight: event.screenHeight,
      );
    });

    on<SendScrollEvent>((event, emit) {
      repository.sendScroll(
        x: event.x,
        y: event.y,
        distanceX: event.distanceX,
        distanceY: event.distanceY,
        screenWidth: event.screenWidth,
        screenHeight: event.screenHeight,
      );
    });

    on<SendKeyEvent>((event, emit) {
      repository.sendKey(event.keyName);
    });

    on<SendTextEvent>((event, emit) {
      repository.sendText(event.text);
    });

    on<SendClipboardEvent>((event, emit) {
      repository.sendClipboard(event.text);
    });

    on<SendKioskToggleEvent>((event, emit) {
      repository.sendKioskToggle(enabled: event.enabled, package: event.package);
      emit(state.copyWith(isKioskMode: event.enabled, kioskPackage: event.package));
    });
  }
}

