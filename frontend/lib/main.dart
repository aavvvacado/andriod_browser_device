import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:http/http.dart' as http;
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
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: Column(
              children: [
                // Top Header Bar with Live Telemetry
                const SessionHeaderBar(),
                const SizedBox(height: 16),

                // Main Interactive Device Stage
                Expanded(
                  child: BlocBuilder<SessionBloc, SessionState>(
                    builder: (context, state) {
                      if (state is SessionConnected) {
                        return Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            // Interactive Screen View
                            DeviceScreenView(metadata: state.metadata),
                            const SizedBox(width: 24),

                            // Hardware Controls Bar
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
                        return Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.error_outline_rounded, color: AppTheme.danger, size: 54),
                              const SizedBox(height: 16),
                              Text(
                                'Session Error: ${state.message}',
                                style: const TextStyle(color: Colors.white, fontSize: 16),
                              ),
                              const SizedBox(height: 16),
                              ElevatedButton.icon(
                                onPressed: _connectToBackend,
                                icon: const Icon(Icons.refresh_rounded),
                                label: const Text('Retry Connection'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppTheme.primary,
                                  foregroundColor: Colors.white,
                                ),
                              ),
                            ],
                          ),
                        );
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
    );
  }

  Widget _buildSessionEndedCard(BuildContext context, SessionEnded state) {
    return Center(
      child: Container(
        constraints: const BoxConstraints(maxWidth: 540),
        padding: const EdgeInsets.all(32),
        decoration: BoxDecoration(
          color: AppTheme.surface.withValues(alpha: 0.95),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.4),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.primary.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.video_library_rounded, color: AppTheme.primaryLight, size: 48),
            ),
            const SizedBox(height: 20),
            const Text(
              'Session Ended',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
            ),
            const SizedBox(height: 8),
            Text(
              'Session: ${state.sessionId} • ${state.deviceModel}',
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13, fontFamily: 'monospace'),
            ),
            const SizedBox(height: 16),
            const Text(
              'This session was automatically recorded. Would you like to save and download the recording, or delete it from the server to free disk space?',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70, fontSize: 14, height: 1.5),
            ),
            const SizedBox(height: 28),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Option 1: Delete recording
                OutlinedButton.icon(
                  onPressed: () async {
                    context.read<SessionBloc>().add(DeleteRecordingEvent(state.sessionId));
                    try {
                      final host = web.window.location.host.isNotEmpty ? web.window.location.host : 'localhost:3000';
                      final protocol = web.window.location.protocol.startsWith('https') ? 'https:' : 'http:';
                      await http.delete(Uri.parse('$protocol//$host/api/recordings/${state.sessionId}'));
                    } catch (_) {}
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Recording deleted from server to reclaim disk space'),
                          behavior: SnackBarBehavior.floating,
                          duration: Duration(seconds: 2),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.delete_outline_rounded, color: AppTheme.danger),
                  label: const Text('Delete Recording', style: TextStyle(color: AppTheme.danger, fontWeight: FontWeight.bold)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppTheme.danger),
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
                const SizedBox(width: 16),
                // Option 2: Save and Download recording
                ElevatedButton.icon(
                  onPressed: () async {
                    context.read<SessionBloc>().add(SaveRecordingEvent(state.sessionId));
                    try {
                      final host = web.window.location.host.isNotEmpty ? web.window.location.host : 'localhost:3000';
                      final protocol = web.window.location.protocol.startsWith('https') ? 'https:' : 'http:';
                      await http.post(Uri.parse('$protocol//$host/api/recordings/${state.sessionId}/save'));
                      final downloadUrl = '$protocol//$host/api/recordings/${state.sessionId}';
                      web.window.open(downloadUrl, '_blank');
                    } catch (_) {}
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Recording saved and downloading!'),
                          behavior: SnackBarBehavior.floating,
                          duration: Duration(seconds: 2),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.download_rounded, color: Colors.white),
                  label: const Text('Save & Download MP4', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.success,
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            TextButton.icon(
              onPressed: _connectToBackend,
              icon: const Icon(Icons.play_arrow_rounded, color: AppTheme.primaryLight),
              label: const Text('Start New Session', style: TextStyle(color: AppTheme.primaryLight)),
            ),
          ],
        ),
      ),
    );
  }
}
