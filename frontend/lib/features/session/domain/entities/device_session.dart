import 'package:equatable/equatable.dart';

class DeviceMetadata extends Equatable {
  final String model;
  final int width;
  final int height;

  const DeviceMetadata({
    required this.model,
    required this.width,
    required this.height,
  });

  double get aspectRatio => width > 0 && height > 0 ? width / height : 9 / 20;

  @override
  List<Object?> get props => [model, width, height];
}

class SessionConfig extends Equatable {
  final String codec;
  final List<int> rawConfig;

  const SessionConfig({
    required this.codec,
    required this.rawConfig,
  });

  @override
  List<Object?> get props => [codec, rawConfig];
}
