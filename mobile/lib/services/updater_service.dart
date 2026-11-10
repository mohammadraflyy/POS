import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class AppUpdateInfo {
  const AppUpdateInfo({
    required this.currentVersion,
    required this.latestVersion,
    required this.releaseName,
    required this.changelog,
    required this.downloadUrl,
    required this.fileName,
    required this.fileSize,
    required this.isNewer,
  });

  final String currentVersion;
  final String latestVersion;
  final String releaseName;
  final String changelog;
  final String? downloadUrl;
  final String? fileName;
  final int? fileSize;
  final bool isNewer;
}

class UpdaterService {
  UpdaterService({this.repository = 'mohammadraflyy/POS'});

  /// Default GitHub repository in format `owner/repo`
  final String repository;

  static const _channel = MethodChannel('pos/native');
  static const currentAppVersion = String.fromEnvironment('APP_VERSION', defaultValue: '1.0.7');

  /// Checks GitHub releases API for a newer version
  Future<AppUpdateInfo?> checkForUpdate({String? repo, String currentVersion = currentAppVersion}) async {
    final targetRepo = repo ?? repository;
    if (targetRepo.isEmpty || !targetRepo.contains('/')) return null;

    final url = Uri.parse('https://api.github.com/repos/$targetRepo/releases/latest');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    try {
      final request = await client.getUrl(url);
      request.headers.set('User-Agent', 'PointOfSales-App');
      request.headers.set('Accept', 'application/vnd.github.v3+json');
      final response = await request.close();
      if (response.statusCode != 200) return null;

      final body = await response.transform(utf8.decoder).join();
      final data = jsonDecode(body);
      if (data is! Map<String, dynamic>) return null;

      final tagName = data['tag_name']?.toString() ?? '';
      final cleanTag = tagName.replaceAll(RegExp(r'^[vV]'), '').trim();
      final releaseName = data['name']?.toString() ?? tagName;
      final bodyText = data['body']?.toString() ?? '';

      final isNewer = _compareVersions(cleanTag, currentVersion) > 0;

      // Find appropriate asset for current platform
      String? downloadUrl;
      String? assetName;
      int? assetSize;

      final assets = data['assets'];
      if (assets is List) {
        for (final asset in assets) {
          if (asset is Map) {
            final name = asset['name']?.toString().toLowerCase() ?? '';
            final isApk = Platform.isAndroid && name.endsWith('.apk');
            final isWindowsPkg = (Platform.isWindows || !Platform.isAndroid) && (name.endsWith('.exe') || name.endsWith('.msix') || name.endsWith('.zip'));
            if (isApk || isWindowsPkg) {
              downloadUrl = asset['browser_download_url']?.toString();
              assetName = asset['name']?.toString();
              assetSize = (asset['size'] as num?)?.toInt();
              break;
            }
          }
        }
      }

      return AppUpdateInfo(
        currentVersion: currentVersion,
        latestVersion: cleanTag.isEmpty ? tagName : cleanTag,
        releaseName: releaseName,
        changelog: bodyText,
        downloadUrl: downloadUrl,
        fileName: assetName,
        fileSize: assetSize,
        isNewer: isNewer,
      );
    } catch (e) {
      debugPrint('[updater] check error: $e');
      return null;
    } finally {
      client.close();
    }
  }

  /// Downloads file and triggers installer on device
  Future<void> downloadAndInstall({
    required String downloadUrl,
    required String fileName,
    void Function(int received, int total)? onProgress,
  }) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    try {
      final request = await client.getUrl(Uri.parse(downloadUrl));
      request.headers.set('User-Agent', 'PointOfSales-App');
      final response = await request.close();
      if (response.statusCode != 200) {
        throw Exception('Gagal mengunduh file update (${response.statusCode})');
      }

      final total = response.contentLength;
      Directory saveDir = Directory.systemTemp;
      if (Platform.isAndroid) {
        try {
          final paths = await _channel.invokeMethod<Map<Object?, Object?>>('paths');
          final cachePath = paths?['cacheDir']?.toString();
          if (cachePath != null && cachePath.isNotEmpty) {
            saveDir = Directory(cachePath);
          }
        } catch (_) {}
      }
      final saveFile = File('${saveDir.path}/$fileName');
      final sink = saveFile.openWrite();

      var received = 0;
      await for (final chunk in response) {
        sink.add(chunk);
        received += chunk.length;
        onProgress?.call(received, total);
      }
      await sink.flush();
      await sink.close();

      // Trigger installation
      if (Platform.isAndroid) {
        await _channel.invokeMethod('installApk', {'path': saveFile.path});
      } else if (Platform.isWindows) {
        if (saveFile.path.toLowerCase().endsWith('.zip')) {
          await Process.start('explorer.exe', ['/select,', saveFile.path]);
        } else {
          await Process.start(saveFile.path, [], mode: ProcessStartMode.detached);
          // Beri jeda singkat agar installer Windows mulai berjalan, lalu tutup aplikasi
          // agar proses point_of_sales.exe tidak mengunci file yang akan ditimpa.
          await Future.delayed(const Duration(milliseconds: 800));
          exit(0);
        }
      }
    } finally {
      client.close();
    }
  }

  /// Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal
  int _compareVersions(String v1, String v2) {
    final clean1 = v1.split(RegExp(r'[-+]')).first;
    final clean2 = v2.split(RegExp(r'[-+]')).first;
    final p1 = clean1.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    final p2 = clean2.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    final len = p1.length > p2.length ? p1.length : p2.length;
    for (var i = 0; i < len; i++) {
      final num1 = i < p1.length ? p1[i] : 0;
      final num2 = i < p2.length ? p2[i] : 0;
      if (num1 != num2) return num1.compareTo(num2);
    }
    return 0;
  }
}

/// Menampilkan dialog pengecekan dan instalasi pembaruan aplikasi baik di Desktop maupun Mobile
Future<void> promptAppUpdate(BuildContext context, {bool notifyIfLatest = true}) async {
  final updater = UpdaterService();
  
  // Tampilkan progress pengecekan
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => const Center(
      child: Card(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
              SizedBox(width: 16),
              Text('Memeriksa pembaruan rilis…'),
            ],
          ),
        ),
      ),
    ),
  );

  AppUpdateInfo? info;
  try {
    info = await updater.checkForUpdate();
  } catch (_) {}

  if (!context.mounted) return;
  Navigator.of(context, rootNavigator: true).pop(); // Tutup loading

  if (info == null) {
    if (context.mounted && notifyIfLatest) {
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Gagal Memeriksa'),
          content: const Text('Tidak dapat terhubung ke server rilis GitHub. Pastikan perangkat terhubung ke internet.'),
          actions: [
            FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Mengerti')),
          ],
        ),
      );
    }
    return;
  }

  if (!info.isNewer) {
    if (context.mounted && notifyIfLatest) {
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Aplikasi Sudah Versi Terbaru'),
          content: Text('Point of Sales Anda (v${info?.currentVersion}) sudah merupakan versi paling mutakhir.'),
          actions: [
            FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Tutup')),
          ],
        ),
      );
    }
    return;
  }

  if (!context.mounted) return;

  // Dialog konfirmasi rilis baru
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _AppUpdateDialog(info: info!, updater: updater),
  );
}

class _AppUpdateDialog extends StatefulWidget {
  const _AppUpdateDialog({required this.info, required this.updater});
  final AppUpdateInfo info;
  final UpdaterService updater;

  @override
  State<_AppUpdateDialog> createState() => _AppUpdateDialogState();
}

class _AppUpdateDialogState extends State<_AppUpdateDialog> {
  double? _progress;
  bool _downloading = false;
  String? _error;

  Future<void> _startUpdate() async {
    if (widget.info.downloadUrl == null || widget.info.fileName == null) {
      _openInBrowser();
      return;
    }

    setState(() {
      _downloading = true;
      _error = null;
      _progress = 0.0;
    });

    try {
      await widget.updater.downloadAndInstall(
        downloadUrl: widget.info.downloadUrl!,
        fileName: widget.info.fileName!,
        onProgress: (received, total) {
          if (mounted && total > 0) {
            setState(() => _progress = received / total);
          }
        },
      );
      if (mounted) {
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _downloading = false;
          _error = e.toString();
        });
      }
    }
  }

  void _openInBrowser() {
    final url = 'https://github.com/${widget.updater.repository}/releases/latest';
    if (Platform.isWindows) {
      Process.start('cmd.exe', ['/c', 'start', '', url]);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.system_update, color: Colors.blueAccent),
          const SizedBox(width: 10),
          Expanded(child: Text('Pembaruan ${widget.info.releaseName}')),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Versi baru tersedia: v${widget.info.latestVersion} (versi saat ini: v${widget.info.currentVersion})',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            if (widget.info.changelog.isNotEmpty) ...[
              const Text('Catatan Perubahan:', style: TextStyle(fontSize: 12, color: Colors.grey)),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.all(8),
                constraints: const BoxConstraints(maxHeight: 120),
                decoration: BoxDecoration(
                  color: Colors.black12,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: SingleChildScrollView(
                  child: Text(widget.info.changelog, style: const TextStyle(fontSize: 12)),
                ),
              ),
              const SizedBox(height: 10),
            ],
            if (_downloading) ...[
              LinearProgressIndicator(value: _progress),
              const SizedBox(height: 6),
              Text(
                (_progress ?? 0) >= 1.0 && Platform.isWindows
                    ? 'Unduhan selesai. Menutup aplikasi untuk memasang pembaruan…'
                    : 'Mengunduh… ${((_progress ?? 0) * 100).toInt()}%',
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12)),
            ],
          ],
        ),
      ),
      actions: [
        if (!_downloading) ...[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Nanti saja'),
          ),
          if (Platform.isWindows)
            TextButton(
              onPressed: _openInBrowser,
              child: const Text('Buka di Browser'),
            ),
          FilledButton.icon(
            onPressed: _startUpdate,
            icon: const Icon(Icons.download, size: 16),
            label: Text(widget.info.downloadUrl != null ? 'Unduh & Perbarui' : 'Lihat Rilis'),
          ),
        ],
      ],
    );
  }
}

