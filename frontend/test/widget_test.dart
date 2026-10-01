import 'package:flutter_test/flutter_test.dart';
import 'package:android_browser_device/features/session/domain/entities/device_session.dart';

void main() {
  test('DeviceMetadata entity computes aspect ratio correctly', () {
    const metadata = DeviceMetadata(model: 'SM-A226B', width: 488, height: 1080);
    expect(metadata.aspectRatio, closeTo(488 / 1080, 0.001));
    expect(metadata.model, 'SM-A226B');
  });
}
