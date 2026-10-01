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
          width: 155,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
          decoration: BoxDecoration(
            color: AppTheme.surface.withValues(alpha: 0.95),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.4),
                blurRadius: 20,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Section 1: Kiosk Restricted Access (Bonus 4)
              _buildFeatureButton(
                context,
                icon: isKiosk ? Icons.lock_rounded : Icons.lock_open_rounded,
                label: isKiosk ? 'Kiosk: Locked' : 'Kiosk Mode',
                subtitle: isKiosk ? 'Calculator App' : 'Off',
                isActive: isKiosk,
                activeColor: Colors.amber.shade700,
                onTap: () {
                  final newEnabled = !isKiosk;
                  context.read<InputBloc>().add(SendKioskToggleEvent(
                    enabled: newEnabled,
                  ));
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        newEnabled
                          ? 'Kiosk Mode ENABLED: Restricted to Device Calculator'
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
                label: 'Paste to Device',
                subtitle: 'Two-Way Sync',
                onTap: () async {
                  try {
                    final textJS = await web.window.navigator.clipboard.readText().toDart;
                    final text = textJS.toDart;
                    if (text.isNotEmpty && context.mounted) {
                      context.read<InputBloc>().add(SendClipboardEvent(text));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Pasted "$text" to Android'),
                          duration: const Duration(seconds: 1),
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
                onTap: () {
                  showDialog(
                    context: context,
                    builder: (_) => const RecordingsDialog(),
                  );
                },
              ),

              const Padding(
                padding: EdgeInsets.symmetric(vertical: 10),
                child: Divider(height: 1, color: Colors.white12),
              ),

              // Section 4: Secondary Convenience Hardware Controls
              const Center(
                child: Text(
                  'CONVENIENCE KEYS',
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.white38, letterSpacing: 1),
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
                    ? () => _showBlockedAlert(context, 'Recent apps is disabled in Kiosk mode')
                    : () => context.read<InputBloc>().add(const SendKeyEvent('Recents')),
              ),
              const SizedBox(height: 6),

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
        title: const Text('Paste Text to Device', style: TextStyle(color: Colors.white, fontSize: 16)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            hintText: 'Type or paste text here...',
            hintStyle: TextStyle(color: Colors.white38),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              if (controller.text.isNotEmpty) {
                context.read<InputBloc>().add(SendClipboardEvent(controller.text));
              }
              Navigator.of(dialogCtx).pop();
            },
            child: const Text('Send'),
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
  }) {
    final color = isActive ? (activeColor ?? AppTheme.primary) : AppTheme.surfaceLight.withValues(alpha: 0.5);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive ? Colors.amber.withValues(alpha: 0.5) : Colors.white.withValues(alpha: 0.08),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: isActive ? Colors.white : AppTheme.primaryLight),
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
                      color: isActive ? Colors.white70 : AppTheme.textSecondary,
                      fontSize: 10,
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
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: isDisabled
              ? Colors.white.withValues(alpha: 0.03)
              : isPrimary
                  ? AppTheme.primary
                  : AppTheme.surfaceLight.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isDisabled
                ? Colors.white.withValues(alpha: 0.04)
                : isPrimary
                    ? AppTheme.primaryLight
                    : Colors.white.withValues(alpha: 0.06),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 14,
              color: isDisabled ? Colors.white30 : Colors.white,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: isDisabled ? Colors.white30 : Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w500,
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
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 7),
        decoration: BoxDecoration(
          color: AppTheme.surfaceLight.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 13, color: Colors.white),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}
