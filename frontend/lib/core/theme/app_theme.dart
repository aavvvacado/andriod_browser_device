import 'package:flutter/material.dart';

class AppTheme {
  // Rich Studio Dark Palette
  static const Color background = Color(0xFF090D16);
  static const Color backgroundSecondary = Color(0xFF0D1322);
  static const Color surface = Color(0xFF121927);
  static const Color surfaceLight = Color(0xFF1B2438);
  static const Color surfaceElevated = Color(0xFF222E46);
  static const Color surfaceBorder = Color(0x1AFFFFFF);

  // Vibrant Accents
  static const Color primary = Color(0xFF6366F1); // Electric Indigo
  static const Color primaryLight = Color(0xFF818CF8);
  static const Color accentCyan = Color(0xFF06B6D4); // Cyber Cyan
  static const Color accentEmerald = Color(0xFF10B981); // Live Emerald
  static const Color success = Color(0xFF10B981);
  static const Color danger = Color(0xFFF43F5E); // Rose Crimson
  static const Color warning = Color(0xFFF59E0B); // Amber Glow

  // Typography Colors
  static const Color textPrimary = Color(0xFFF8FAFC);
  static const Color textSecondary = Color(0xFF94A3B8);
  static const Color textMuted = Color(0xFF64748B);

  static ThemeData get darkTheme {
    return ThemeData.dark().copyWith(
      scaffoldBackgroundColor: background,
      primaryColor: primary,
      colorScheme: const ColorScheme.dark(
        primary: primary,
        secondary: accentCyan,
        surface: surface,
        error: danger,
      ),
      cardTheme: CardThemeData(
        color: surface.withValues(alpha: 0.9),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: surfaceBorder),
        ),
      ),
      textTheme: const TextTheme(
        titleLarge: TextStyle(color: textPrimary, fontWeight: FontWeight.bold, fontSize: 18, letterSpacing: -0.2),
        bodyMedium: TextStyle(color: textSecondary, fontSize: 14),
        labelMedium: TextStyle(color: textSecondary, fontFamily: 'monospace', fontSize: 13),
      ),
    );
  }
}
