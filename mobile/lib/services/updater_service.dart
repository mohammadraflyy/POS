import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
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
  static const currentAppVersion = '1.0.0';

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
        await Process.start(saveFile.path, [], mode: ProcessStartMode.detached);
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

