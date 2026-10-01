import 'dart:ui';

class CoordinateNormalizer {
  /// Transforms a local widget touch coordinate to device screen pixel coordinate
  /// taking into account the letterbox/pillarbox aspect ratio scaling.
  static Offset normalize({
    required Offset localPosition,
    required Size renderedSize,
    required Size deviceResolution,
  }) {
    if (renderedSize.width == 0 || renderedSize.height == 0) {
      return Offset.zero;
    }

    final double scaleX = deviceResolution.width / renderedSize.width;
    final double scaleY = deviceResolution.height / renderedSize.height;

    final double deviceX = (localPosition.dx * scaleX).clamp(0.0, deviceResolution.width);
    final double deviceY = (localPosition.dy * scaleY).clamp(0.0, deviceResolution.height);

    return Offset(deviceX, deviceY);
  }
}
