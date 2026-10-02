import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:web/web.dart' as web;
import 'dart:js_interop';
import '../bloc/input_bloc.dart';
import '../../../session/presentation/widgets/recordings_dialog.dart';
import '../../../../core/theme/app_theme.dart';

class DeviceControlsBar extends StatelessWidget {
  const DeviceControlsBar({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<InputBloc, InputState>(
      builder: (context, inputState) {
        final bool isKiosk = inputState.isKioskMode;

        return Container(
          width: 170,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
          decoration: BoxDecoration(
            color: AppTheme.surface.withValues(alpha: 0.88),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.45),
                blurRadius: 24,
                offset: const Offset(0, 10),
              ),
              BoxShadow(
                color: AppTheme.primary.withValues(alpha: 0.04),
                blurRadius: 30,
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Dock Header
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.tune_rounded, size: 14, color: AppTheme.accentCyan.withValues(alpha: 0.8)),
                  const SizedBox(width: 6),
                  const Text(
                    'STUDIO DOCK',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: AppTheme.textSecondary,
                      letterSpacing: 1.2,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Section 1: Kiosk Restricted Access (Bonus 4)
              _buildFeatureButton(
                context,
                icon: isKiosk ? Icons.shield_rounded : Icons.shield_outlined,
                label: isKiosk ? 'Kiosk Active' : 'Kiosk Mode',
                subtitle: isKiosk ? 'Locked: ${inputState.kioskAppName}' : 'Single-App Lock',
                isActive: isKiosk,
                activeColor: Colors.amber.shade600,
                onTap: () {
                  final newEnabled = !isKiosk;
                  context.read<InputBloc>().add(SendKioskToggleEvent(
                    enabled: newEnabled,
                  ));
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        newEnabled
                          ? 'Kiosk Mode ENABLED: Device restricted to ${inputState.kioskAppName}'
                          : 'Kiosk Mode DISABLED: Full device access restored',
                      ),
                      duration: const Duration(seconds: 2),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                },
              ),
              const SizedBox(height: 8),

              // Section 2: Two-Way Clipboard (Bonus 3)
              _buildFeatureButton(
                context,
                icon: Icons.content_paste_rounded,
                label: 'Paste to Phone',
                subtitle: 'PC ➔ Device',
                accentColor: AppTheme.accentCyan,
                onTap: () async {
                  try {
                    final textJS = await web.window.navigator.clipboard.readText().toDart;
                    final text = textJS.toDart;
                    if (text.isNotEmpty && context.mounted) {
                      context.read<InputBloc>().add(SendClipboardEvent(text));
                      final preview = text.length > 30 ? '${text.substring(0, 30)}...' : text;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Pasted "$preview" (${text.length} chars) to Android'),
                          duration: const Duration(seconds: 2),
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    }
                  } catch (_) {
                    if (context.mounted) {
                      _showManualPasteDialog(context);
                    }
                  }
                },
              ),
              const SizedBox(height: 8),

              // Section 3: Session Recordings (Bonus 5)
              _buildFeatureButton(
                context,
                icon: Icons.video_library_rounded,
                label: 'Recordings',
                subtitle: 'Auto-Saved MP4',
                accentColor: AppTheme.primaryLight,
                onTap: () {
                  showDialog(
                    context: context,
                    builder: (_) => const RecordingsDialog(),
                  );
                },
              ),

              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Divider(height: 1, color: Colors.white10),
              ),

              // Section 4: Android 3-Button Navigation
              const Center(
                child: Text(
                  'NAVIGATION',
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white30, letterSpacing: 1),
                ),
              ),
              const SizedBox(height: 8),

              _buildNavButton(
                context,
                icon: Icons.arrow_back_ios_new_rounded,
                label: 'Back',
                onTap: () => context.read<InputBloc>().add(const SendKeyEvent('Back')),
              ),
              const SizedBox(height: 6),

              _buildNavButton(
                context,
                icon: isKiosk ? Icons.lock_outline_rounded : Icons.circle_outlined,
                label: 'Home',
                isDisabled: isKiosk,
                isPrimary: !isKiosk,
                onTap: isKiosk
                    ? () => _showBlockedAlert(context, 'Home navigation is disabled in Kiosk mode')
                    : () => context.read<InputBloc>().add(const SendKeyEvent('Home')),
              ),
              const SizedBox(height: 6),

              _buildNavButton(
                context,
                icon: isKiosk ? Icons.lock_outline_rounded : Icons.crop_square_rounded,
                label: 'Recents',
                isDisabled: isKiosk,
                onTap: isKiosk
                    ? () => _showBlockedAlert(context, 'Recent apps view is disabled in Kiosk mode')
                    : () => context.read<InputBloc>().add(const SendKeyEvent('Recents')),
              ),

              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Divider(height: 1, color: Colors.white10),
              ),

              // Section 5: Hardware Keys (Volume & Power)
              const Center(
                child: Text(
                  'HARDWARE KEYS',
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white30, letterSpacing: 1),
                ),
              ),
              const SizedBox(height: 8),

              Row(
                children: [
                  Expanded(
                    child: _buildMiniButton(
                      context,
                      icon: Icons.volume_up_rounded,
                      label: 'Vol +',
                      onTap: () => context.read<InputBloc>().add(const SendKeyEvent('VolumeUp')),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: _buildMiniButton(
                      context,
                      icon: Icons.volume_down_rounded,
                      label: 'Vol -',
                      onTap: () => context.read<InputBloc>().add(const SendKeyEvent('VolumeDown')),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              _buildMiniButton(
                context,
                icon: Icons.power_settings_new_rounded,
                label: 'Power / Sleep',
                onTap: () => context.read<InputBloc>().add(const SendKeyEvent('Power')),
              ),
            ],
          ),
        );
      },
    );
  }

  void _showBlockedAlert(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.shield_rounded, color: Colors.amber, size: 20),
            const SizedBox(width: 10),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: AppTheme.surface,
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _showManualPasteDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Paste Text to Device', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'Type or paste text here...',
            hintStyle: const TextStyle(color: Colors.white38),
            filled: true,
            fillColor: AppTheme.surfaceLight,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () {
              if (controller.text.isNotEmpty) {
                context.read<InputBloc>().add(SendClipboardEvent(controller.text));
              }
              Navigator.of(dialogCtx).pop();
            },
            child: const Text('Send to Device'),
          ),
        ],
      ),
    );
  }

  Widget _buildFeatureButton(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String subtitle,
    required VoidCallback onTap,
    bool isActive = false,
    Color? activeColor,
    Color? accentColor,
  }) {
    final color = isActive
        ? (activeColor ?? AppTheme.primary).withValues(alpha: 0.2)
        : AppTheme.surfaceLight.withValues(alpha: 0.5);

    final borderColor = isActive
        ? (activeColor ?? AppTheme.primary).withValues(alpha: 0.6)
        : Colors.white.withValues(alpha: 0.06);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: borderColor),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: (isActive ? (activeColor ?? AppTheme.primary) : (accentColor ?? AppTheme.primary))
                    .withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                icon,
                size: 16,
                color: isActive ? (activeColor ?? Colors.amber) : (accentColor ?? AppTheme.primaryLight),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: isActive ? FontWeight.bold : FontWeight.w600,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: isActive ? (activeColor ?? Colors.amber) : AppTheme.textSecondary,
                      fontSize: 10,
                      fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNavButton(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    bool isPrimary = false,
    bool isDisabled = false,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: isDisabled
              ? Colors.white.withValues(alpha: 0.02)
              : isPrimary
                  ? AppTheme.primary.withValues(alpha: 0.9)
                  : AppTheme.surfaceLight.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isDisabled
                ? Colors.white.withValues(alpha: 0.03)
                : isPrimary
                    ? AppTheme.primaryLight.withValues(alpha: 0.5)
                    : Colors.white.withValues(alpha: 0.06),
          ),
          boxShadow: isPrimary
              ? [
                  BoxShadow(
                    color: AppTheme.primary.withValues(alpha: 0.3),
                    blurRadius: 10,
                    offset: const Offset(0, 3),
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 14,
              color: isDisabled ? Colors.white24 : Colors.white,
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                color: isDisabled ? Colors.white24 : Colors.white,
                fontSize: 12,
                fontWeight: isPrimary ? FontWeight.bold : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMiniButton(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: AppTheme.surfaceLight.withValues(alpha: 0.35),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 13, color: AppTheme.textPrimary),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 11, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}

