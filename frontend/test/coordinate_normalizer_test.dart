import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:android_browser_device/core/utils/coordinate_normalizer.dart';

void main() {
  group('CoordinateNormalizer Unit Tests', () {
    test('normalizes top-left coordinate to (0, 0)', () {
      final norm = CoordinateNormalizer.normalize(
        localPosition: const Offset(0, 0),
        renderedSize: const Size(400, 800),
        deviceResolution: const Size(1080, 2400),
      );

      expect(norm.dx, 0.0);
      expect(norm.dy, 0.0);
    });

    test('normalizes bottom-right coordinate accurately', () {
      final norm = CoordinateNormalizer.normalize(
        localPosition: const Offset(400, 800),
        renderedSize: const Size(400, 800),
        deviceResolution: const Size(1080, 2400),
      );

      expect(norm.dx, 1080.0);
      expect(norm.dy, 2400.0);
    });

    test('normalizes midpoint coordinate accurately', () {
      final norm = CoordinateNormalizer.normalize(
        localPosition: const Offset(200, 400),
        renderedSize: const Size(400, 800),
        deviceResolution: const Size(1080, 2400),
      );

      expect(norm.dx, 540.0);
      expect(norm.dy, 1200.0);
    });

    test('clamps coordinates exceeding boundaries', () {
      final norm = CoordinateNormalizer.normalize(
        localPosition: const Offset(500, 900),
        renderedSize: const Size(400, 800),
        deviceResolution: const Size(1080, 2400),
      );

      expect(norm.dx, 1080.0);
      expect(norm.dy, 2400.0);
    });
  });
}
