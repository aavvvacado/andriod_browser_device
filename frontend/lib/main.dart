import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:web/web.dart' as web;
import 'core/di/injection_container.dart';
import 'core/theme/app_theme.dart';
import 'features/session/domain/repositories/session_repository.dart';
import 'features/session/presentation/bloc/session_bloc.dart';
import 'features/latency/presentation/bloc/latency_bloc.dart';
import 'features/input/presentation/bloc/input_bloc.dart';
import 'features/session/presentation/widgets/session_header_bar.dart';
import 'features/input/presentation/widgets/device_screen_view.dart';
import 'features/input/presentation/widgets/device_controls_bar.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initServiceLocator();
  runApp(const AndroidBrowserDeviceApp());
}

class AndroidBrowserDeviceApp extends StatelessWidget {
  const AndroidBrowserDeviceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider<ISessionRepository>.value(value: sl<ISessionRepository>()),
      ],
      child: MultiBlocProvider(
        providers: [
          BlocProvider<SessionBloc>(create: (_) => sl<SessionBloc>()),
          BlocProvider<LatencyBloc>(create: (_) => sl<LatencyBloc>()),
          BlocProvider<InputBloc>(create: (_) => sl<InputBloc>()),
        ],
        child: MaterialApp(
          title: 'Android Browser Device',
          theme: AppTheme.darkTheme,
          debugShowCheckedModeBanner: false,
          home: const DeviceSessionScreen(),
        ),
      ),
    );
  }
}

class DeviceSessionScreen extends StatefulWidget {
  const DeviceSessionScreen({super.key});

  @override
  State<DeviceSessionScreen> createState() => _DeviceSessionScreenState();
}

class _DeviceSessionScreenState extends State<DeviceSessionScreen> {
  @override
  void initState() {
    super.initState();
    _connectToBackend();
  }

  String _getOrCreateClientToken() {
    String? token = web.window.localStorage.getItem('client_token');
    if (token == null || token.isEmpty) {
      token = 'ct_${DateTime.now().millisecondsSinceEpoch}';
      web.window.localStorage.setItem('client_token', token);
    }
    return token;
  }

  void _connectToBackend() {
    // Dynamic host discovery for local dev and cloud deployment
    final host = web.window.location.host.isNotEmpty ? web.window.location.host : 'localhost:3000';
    final protocol = web.window.location.protocol == 'https:' ? 'wss:' : 'ws:';
    final token = _getOrCreateClientToken();
    final wsUrl = '$protocol//$host?clientToken=$token';

    context.read<SessionBloc>().add(ConnectSessionEvent(wsUrl));
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<SessionBloc, SessionState>(
      listener: (context, state) {
        if (state is SessionConnected) {
          context.read<LatencyBloc>().add(StartPingLoopEvent());
        } else if (state is SessionDisconnected || state is SessionError || state is SessionEnded) {
          context.read<LatencyBloc>().add(StopPingLoopEvent());
        }
      },
      child: Scaffold(
        backgroundColor: AppTheme.background,
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0.0, -0.15),
              radius: 1.3,
              colors: [
                Color(0xFF131929), // Subtle studio backlight bloom behind phone
                Color(0xFF080B12), // Midnight obsidian background
              ],
            ),
          ),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Column(
                children: [
                  // Top Header Bar with Live Telemetry
                  const SessionHeaderBar(),
                  const SizedBox(height: 10),

                  // Main Interactive Device Stage
                  Expanded(
                    child: BlocBuilder<SessionBloc, SessionState>(
                      builder: (context, state) {
                        if (state is SessionConnected) {
                          return Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              // Interactive Screen View (Takes full vertical space)
                              DeviceScreenView(metadata: state.metadata),
                              const SizedBox(width: 20),

                              // Hardware Controls Studio Dock
                              const DeviceControlsBar(),
                            ],
                          );
                      } else if (state is SessionConnecting) {
                        return const Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              CircularProgressIndicator(color: AppTheme.primaryLight),
                              SizedBox(height: 20),
                              Text(
                                'Connecting to Android Device Session...',
                                style: TextStyle(color: AppTheme.textSecondary, fontSize: 16),
                              ),
                            ],
                          ),
                        );
                      } else if (state is SessionEnded) {
                        return _buildSessionEndedCard(context, state);
                      } else if (state is SessionError) {
                        return _buildSessionErrorCard(context, state);
                      } else {
                        return Center(
                          child: ElevatedButton.icon(
                            onPressed: _connectToBackend,
                            icon: const Icon(Icons.play_arrow_rounded),
                            label: const Text('Start Device Session'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                            ),
                          ),
                        );
                      }
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  }

  Widget _buildSessionEndedCard(BuildContext context, SessionEnded state) {
    return Center(
      child: Container(
        constraints: const BoxConstraints(maxWidth: 480),
        padding: const EdgeInsets.all(36),
        decoration: BoxDecoration(
          color: AppTheme.surface.withValues(alpha: 0.95),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.45),
              blurRadius: 28,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.success.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle_outline_rounded, color: AppTheme.success, size: 48),
            ),
            const SizedBox(height: 20),
            const Text(
              'Session Ended Cleanly',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
            ),
            const SizedBox(height: 8),
            Text(
              '${state.deviceModel} • ${state.sessionId}',
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13, fontFamily: 'monospace'),
            ),
            const SizedBox(height: 16),
            const Text(
              'Your Android session has concluded. All dedicated scrcpy processes, ADB tunnels, and buffers have been deterministically cleaned up and the device returned to the pool.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70, fontSize: 14, height: 1.5),
            ),
            const SizedBox(height: 28),
            ElevatedButton.icon(
              onPressed: _connectToBackend,
              icon: const Icon(Icons.play_arrow_rounded),
              label: const Text('Start New Session', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSessionErrorCard(BuildContext context, SessionError state) {
    final isOccupied = state.message.toLowerCase().contains('occupied') ||
        state.message.toLowerCase().contains('capacity') ||
        state.message.toLowerCase().contains('leased') ||
        state.message.toLowerCase().contains('in use');

    return Center(
      child: Container(
        constraints: const BoxConstraints(maxWidth: 480),
        padding: const EdgeInsets.all(36),
        decoration: BoxDecoration(
          color: AppTheme.surface.withValues(alpha: 0.95),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: (isOccupied ? Colors.amber : AppTheme.danger).withValues(alpha: 0.3),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.45),
              blurRadius: 28,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: (isOccupied ? Colors.amber : AppTheme.danger).withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isOccupied ? Icons.devices_other_rounded : Icons.wifi_off_rounded,
                color: isOccupied ? Colors.amber : AppTheme.danger,
                size: 48,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              isOccupied ? 'All Devices Occupied' : 'Session Connection Error',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
            ),
            const SizedBox(height: 12),
            Text(
              isOccupied
                ? 'All isolated Android instances in the server pool are currently in use by active parallel sessions. A device will become available as soon as an active session is closed.'
                : state.message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 14, height: 1.5),
            ),
            const SizedBox(height: 28),
            ElevatedButton.icon(
              onPressed: _connectToBackend,
              icon: const Icon(Icons.refresh_rounded),
              label: Text(
                isOccupied ? 'Check Availability & Retry' : 'Retry Connection',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: isOccupied ? Colors.amber.shade700 : AppTheme.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
