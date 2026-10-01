import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:web/web.dart' as web;
import '../../../../core/theme/app_theme.dart';

class RecordingsDialog extends StatefulWidget {
  const RecordingsDialog({super.key});

  @override
  State<RecordingsDialog> createState() => _RecordingsDialogState();
}

class _RecordingsDialogState extends State<RecordingsDialog> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _recordings = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchRecordings();
  }

  String _getClientToken() {
    return web.window.localStorage.getItem('client_token') ?? '';
  }

  Future<void> _fetchRecordings() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final host = web.window.location.host.isNotEmpty ? web.window.location.host : 'localhost:3000';
      final protocol = web.window.location.protocol.startsWith('https') ? 'https:' : 'http:';
      final token = _getClientToken();
      final uri = Uri.parse('$protocol//$host/api/recordings?clientToken=$token');
      final res = await http.get(uri, headers: token.isNotEmpty ? {'x-client-token': token} : {});

      if (res.statusCode == 200) {
        final List<dynamic> decoded = jsonDecode(res.body);
        setState(() {
          _recordings = decoded.cast<Map<String, dynamic>>();
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = 'Failed to load recordings (HTTP ${res.statusCode})';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Error fetching recordings: $e';
        _isLoading = false;
      });
    }
  }

  void _downloadRecording(String sessionId) {
    final host = web.window.location.host.isNotEmpty ? web.window.location.host : 'localhost:3000';
    final protocol = web.window.location.protocol.startsWith('https') ? 'https:' : 'http:';
    final token = _getClientToken();
    final url = '$protocol//$host/api/recordings/$sessionId?clientToken=$token';
    web.window.open(url, '_blank');
  }

  Future<void> _deleteRecording(String sessionId) async {
    try {
      final host = web.window.location.host.isNotEmpty ? web.window.location.host : 'localhost:3000';
      final protocol = web.window.location.protocol.startsWith('https') ? 'https:' : 'http:';
      final token = _getClientToken();
      final res = await http.delete(
        Uri.parse('$protocol//$host/api/recordings/$sessionId?clientToken=$token'),
        headers: token.isNotEmpty ? {'x-client-token': token} : {},
      );
      if (res.statusCode == 200 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Deleted recording $sessionId from server disk'),
            behavior: SnackBarBehavior.floating,
            duration: const Duration(seconds: 2),
          ),
        );
        _fetchRecordings();
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: Container(
        width: 600,
        height: 500,
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.video_library_rounded, color: AppTheme.primaryLight, size: 24),
                const SizedBox(width: 12),
                const Text(
                  'Session Recordings',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.refresh_rounded, color: AppTheme.textSecondary),
                  onPressed: _fetchRecordings,
                  tooltip: 'Refresh',
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded, color: AppTheme.textSecondary),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'Each session is automatically recorded as high-fps H.264 video and converted to MP4 for instant download and playback.',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
            ),
            const Divider(height: 24, color: Colors.white12),
            Expanded(
              child: _buildBody(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.primaryLight));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded, color: AppTheme.danger, size: 40),
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.white70)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _fetchRecordings, child: const Text('Retry')),
          ],
        ),
      );
    }

    if (_recordings.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.videocam_off_outlined, color: Colors.white.withValues(alpha: 0.2), size: 48),
            const SizedBox(height: 12),
            const Text(
              'No recorded sessions yet.',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 15),
            ),
            const SizedBox(height: 6),
            const Text(
              'A recording is saved whenever a device session ends.',
              style: TextStyle(color: Colors.white38, fontSize: 12),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      itemCount: _recordings.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final rec = _recordings[index];
        final id = rec['sessionId'] as String? ?? 'Unknown';
        final durationMs = (rec['durationMs'] as num?)?.toInt() ?? 0;
        final durationSec = (durationMs / 1000).toStringAsFixed(1);
        final sizeBytes = (rec['fileSizeBytes'] as num?)?.toInt() ?? 0;
        final sizeKb = (sizeBytes / 1024).toStringAsFixed(0);
        final status = rec['status'] as String? ?? 'completed';
        final startTime = rec['startTime'] as num?;
        final dateStr = startTime != null
            ? DateTime.fromMillisecondsSinceEpoch(startTime.toInt()).toLocal().toString().split('.')[0]
            : 'Recent';

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: AppTheme.surfaceLight.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.movie_creation_outlined, color: AppTheme.primaryLight, size: 20),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      id,
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white, fontSize: 14),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '$dateStr • ${durationSec}s • $sizeKb KB • Status: $status',
                      style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              ElevatedButton.icon(
                onPressed: () => _downloadRecording(id),
                icon: const Icon(Icons.download_rounded, size: 16),
                label: const Text('Download MP4'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, color: AppTheme.danger, size: 20),
                tooltip: 'Delete recording from server',
                onPressed: () => _deleteRecording(id),
              ),
            ],
          ),
        );
      },
    );
  }
}
