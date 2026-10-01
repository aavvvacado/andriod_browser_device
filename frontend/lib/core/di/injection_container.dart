import 'package:get_it/get_it.dart';
import '../../features/session/data/datasources/session_websocket_datasource.dart';
import '../../features/session/data/repositories/session_repository_impl.dart';
import '../../features/session/domain/repositories/session_repository.dart';
import '../../features/session/presentation/bloc/session_bloc.dart';
import '../../features/latency/presentation/bloc/latency_bloc.dart';
import '../../features/input/presentation/bloc/input_bloc.dart';

final sl = GetIt.instance;

Future<void> initServiceLocator() async {
  // Data sources
  sl.registerLazySingleton<SessionWebSocketDataSource>(
    () => SessionWebSocketDataSource(),
  );

  // Repositories
  sl.registerLazySingleton<ISessionRepository>(
    () => SessionRepositoryImpl(dataSource: sl()),
  );

  // BLoCs
  sl.registerFactory<SessionBloc>(
    () => SessionBloc(repository: sl()),
  );

  sl.registerFactory<LatencyBloc>(
    () => LatencyBloc(repository: sl()),
  );

  sl.registerFactory<InputBloc>(
    () => InputBloc(repository: sl()),
  );
}
