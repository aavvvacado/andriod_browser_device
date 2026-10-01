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

  void _connectToBackend() {
    // Dynamic host discovery for local dev and cloud deployment
    final host = web.window.location.host.isNotEmpty ? web.window.location.host : 'localhost:3000';
    final protocol = web.window.location.protocol == 'https:' ? 'wss:' : 'ws:';
    final wsUrl = '$protocol//$host';

    context.read<SessionBloc>().add(ConnectSessionEvent(wsUrl));
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<SessionBloc, SessionState>(
      listener: (context, state) {
        if (state is SessionConnected) {
          context.read<LatencyBloc>().add(StartPingLoopEvent());
        } else if (state is SessionDisconnected || state is SessionError) {
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
}
