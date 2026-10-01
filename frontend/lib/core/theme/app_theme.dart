import 'package:flutter/material.dart';

class AppTheme {
  static const Color background = Color(0xFF0F172A);
  static const Color surface = Color(0xFF1E293B);
  static const Color surfaceLight = Color(0xFF334155);
  static const Color primary = Color(0xFF0284C7);
  static const Color primaryLight = Color(0xFF38BDF8);
  static const Color success = Color(0xFF22C55E);
  static const Color danger = Color(0xFFEF4444);
  static const Color textPrimary = Color(0xFFF8FAFC);
  static const Color textSecondary = Color(0xFF94A3B8);

  static ThemeData get darkTheme {
    return ThemeData.dark().copyWith(
      scaffoldBackgroundColor: background,
      primaryColor: primary,
      colorScheme: const ColorScheme.dark(
        primary: primary,
        surface: surface,
        error: danger,
      ),
      cardTheme: CardThemeData(
        color: surface.withValues(alpha: 0.85),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
        ),
      ),
      textTheme: const TextTheme(
        titleLarge: TextStyle(color: textPrimary, fontWeight: FontWeight.w600, fontSize: 18),
        bodyMedium: TextStyle(color: textSecondary, fontSize: 14),
        labelMedium: TextStyle(color: textSecondary, fontFamily: 'monospace', fontSize: 13),
      ),
    );
  }
}
