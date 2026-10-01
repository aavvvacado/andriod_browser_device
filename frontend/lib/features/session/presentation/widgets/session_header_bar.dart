import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/session_bloc.dart';
import '../../../latency/presentation/bloc/latency_bloc.dart';
import '../../../../core/theme/app_theme.dart';

class SessionHeaderBar extends StatelessWidget {
  const SessionHeaderBar({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SessionBloc, SessionState>(
      builder: (context, sessionState) {
        String deviceName = 'Disconnected';
        String resText = '--';
        bool isConnected = false;

        if (sessionState is SessionConnected) {
          deviceName = sessionState.metadata.model;
          resText = '${sessionState.metadata.width}x${sessionState.metadata.height}';
          isConnected = true;
        } else if (sessionState is SessionConnecting) {
          deviceName = 'Connecting to Android Device...';
        }

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          decoration: BoxDecoration(
            color: AppTheme.surface.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.2),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Device Title + Status Dot
              Row(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isConnected ? AppTheme.success : AppTheme.danger,
                      boxShadow: [
                        BoxShadow(
                          color: (isConnected ? AppTheme.success : AppTheme.danger).withValues(alpha: 0.6),
                          blurRadius: 8,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    deviceName,
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AppTheme.textPrimary),
                  ),
                ],
              ),

              // Metrics Badges
              BlocBuilder<LatencyBloc, LatencyState>(
                builder: (context, latencyState) {
                  return Row(
                    children: [
                      _buildMetricBadge('RTT', '${latencyState.rttMs} ms', AppTheme.primaryLight),
                      const SizedBox(width: 12),
                      _buildMetricBadge('FPS', '${latencyState.fps}', AppTheme.success),
                      const SizedBox(width: 12),
                      _buildMetricBadge('Res', resText, AppTheme.textSecondary),
                      if (isConnected) ...[
                        const SizedBox(width: 16),
                        ElevatedButton.icon(
                          onPressed: () {
                            context.read<SessionBloc>().add(StopSessionEvent());
                          },
                          icon: const Icon(Icons.stop_circle_rounded, size: 16, color: Colors.white),
                          label: const Text('Stop Session', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.danger,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            elevation: 0,
                          ),
                        ),
                      ],
                    ],
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildMetricBadge(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.background.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$label: ', style: const TextStyle(color: Colors.white54, fontSize: 12, fontFamily: 'monospace')),
          Text(value, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
        ],
      ),
    );
  }
}
