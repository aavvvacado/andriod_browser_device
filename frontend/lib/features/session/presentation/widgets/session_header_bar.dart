import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/session_bloc.dart';
import '../../../latency/presentation/bloc/latency_bloc.dart';
import '../widgets/recordings_dialog.dart';
import '../../../../core/theme/app_theme.dart';

class SessionHeaderBar extends StatelessWidget {
  const SessionHeaderBar({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SessionBloc, SessionState>(
      builder: (context, sessionState) {
        String deviceName = 'No Device Active';
        String resText = '--';
        bool isConnected = false;

        if (sessionState is SessionConnected) {
          deviceName = sessionState.metadata.model;
          resText = '${sessionState.metadata.width}x${sessionState.metadata.height}';
          isConnected = true;
        } else if (sessionState is SessionConnecting) {
          deviceName = 'Connecting Device...';
        }

        return Container(
          height: 60,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(
            color: AppTheme.surface.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.35),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
              if (isConnected)
                BoxShadow(
                  color: AppTheme.primary.withValues(alpha: 0.05),
                  blurRadius: 30,
                  spreadRadius: 1,
                ),
            ],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Left: Device Brand & Live Status Indicator
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: isConnected
                            ? [AppTheme.primary, AppTheme.accentCyan]
                            : [AppTheme.surfaceLight, AppTheme.surfaceElevated],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(10),
                      boxShadow: [
                        if (isConnected)
                          BoxShadow(
                            color: AppTheme.primary.withValues(alpha: 0.4),
                            blurRadius: 12,
                            offset: const Offset(0, 3),
                          ),
                      ],
                    ),
                    child: Icon(
                      isConnected ? Icons.phone_android_rounded : Icons.phone_android_outlined,
                      size: 18,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            deviceName,
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                              color: AppTheme.textPrimary,
                              letterSpacing: -0.2,
                            ),
                          ),
                          if (isConnected) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppTheme.accentEmerald.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: AppTheme.accentEmerald.withValues(alpha: 0.3)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 5,
                                    height: 5,
                                    decoration: const BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: AppTheme.accentEmerald,
                                    ),
                                  ),
                                  const SizedBox(width: 4),
                                  const Text(
                                    'LIVE',
                                    style: TextStyle(
                                      color: AppTheme.accentEmerald,
                                      fontSize: 9,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 0.6,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        isConnected ? 'Zero-Copy H.264 Stream • WebCodecs Active' : 'Waiting for session stream',
                        style: const TextStyle(color: AppTheme.textMuted, fontSize: 11),
                      ),
                    ],
                  ),
                ],
              ),

              // Center: High-Precision Live Telemetry Badges
              BlocBuilder<LatencyBloc, LatencyState>(
                builder: (context, latencyState) {
                  final rttColor = latencyState.rttMs < 50
                      ? AppTheme.accentEmerald
                      : (latencyState.rttMs < 100 ? AppTheme.accentCyan : AppTheme.warning);

                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildTelemetryChip(
                        icon: Icons.bolt_rounded,
                        label: 'RTT',
                        value: '${latencyState.rttMs} ms',
                        accentColor: rttColor,
                      ),
                      const SizedBox(width: 8),
                      _buildTelemetryChip(
                        icon: Icons.speed_rounded,
                        label: 'FPS',
                        value: '${latencyState.fps}',
                        accentColor: AppTheme.accentCyan,
                      ),
                      const SizedBox(width: 8),
                      _buildTelemetryChip(
                        icon: Icons.aspect_ratio_rounded,
                        label: 'RES',
                        value: resText,
                        accentColor: AppTheme.textSecondary,
                      ),
                    ],
                  );
                },
              ),

              // Right: Session Actions (Recordings & Stop Session)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Recordings Shortcut Button
                  InkWell(
                    onTap: () {
                      showDialog(
                        context: context,
                        builder: (_) => const RecordingsDialog(),
                      );
                    },
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceLight.withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.video_library_rounded, size: 15, color: AppTheme.primaryLight),
                          SizedBox(width: 6),
                          Text(
                            'Recordings',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  if (isConnected) ...[
                    const SizedBox(width: 10),
                    ElevatedButton.icon(
                      onPressed: () {
                        context.read<SessionBloc>().add(StopSessionEvent());
                      },
                      icon: const Icon(Icons.stop_circle_rounded, size: 16, color: Colors.white),
                      label: const Text('Stop Session', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.danger,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        elevation: 0,
                        shadowColor: AppTheme.danger.withValues(alpha: 0.5),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTelemetryChip({
    required IconData icon,
    required String label,
    required String value,
    required Color accentColor,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.background.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: accentColor),
          const SizedBox(width: 5),
          Text(
            '$label ',
            style: const TextStyle(color: AppTheme.textMuted, fontSize: 11, fontWeight: FontWeight.bold),
          ),
          Text(
            value,
            style: TextStyle(
              color: accentColor,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              fontFamily: 'monospace',
            ),
          ),
        ],
      ),
    );
  }
}

