# AI Agent Rules: Real-Time Android Device in the Browser

## Mandatory Process Logging Rule
Maintain a file called `PROCESS_LOG.md` in the project root throughout this work. After each meaningful step, append an entry with: the time, the user's exact prompt (verbatim, not summarised), what you did in response, any errors or failures you hit, and what the user decided next. Record dead ends and abandoned approaches as well as successes. Never rewrite or delete earlier entries. Keep the file up to date as you go, not at the end.

## Architectural & Code Standards
1. **Clean Architecture**: Strict separation of Presentation, Domain, and Data/Infrastructure layers.
2. **Frontend State Management**: BLoC pattern (`flutter_bloc`) for all UI state, stream events, device connection status, latency metrics, and user interactions.
3. **SOLID Principles**: Single responsibility, open/closed, Liskov substitution, interface segregation, and dependency inversion.
4. **Dependency Injection**: Use DI (`get_it` or constructor injection) for testability and loose coupling.
5. **No Blind Assumptions / Spikes First**: Validate uncertain protocols (scrcpy video streaming, input translation, WebRTC/WebSocket decoding) with lightweight spikes before deep integration.
6. **Package Versions**: Never pin old package versions unnecessarily. Prefer resolving the latest stable compatible versions.
7. **Session Lifecycle & Resource Cleanup**: Every allocated process (scrcpy-server, ADB tunnels, WebRTC peer connections, emulator instances) must have deterministically managed lifecycles with graceful cleanup on disconnect or timeout.
