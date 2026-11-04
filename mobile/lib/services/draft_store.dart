import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the till keeps the sale being rung up, so a crash, a closed window or a power cut
/// does not lose it - the desktop app kept the same draft.
abstract class DraftStore {
  Future<String?> read();
  Future<void> write(String data);
  Future<void> clear();

  /// A file next to the shop's data on the PC (secure storage there has a small size
  /// limit); the platform's secure storage on a phone.
  factory DraftStore.forDevice(String scope) {
    // `flutter test` runs on the developer's own PC: never touch the shop's real files
    if (Platform.environment.containsKey('FLUTTER_TEST')) return MemoryDraftStore();
    if (Platform.isWindows) {
      final appData = Platform.environment['APPDATA'] ?? Directory.systemTemp.path;
      final safe = scope.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');
      return FileDraftStore('$appData\\point_of_sales\\keranjang_$safe.json');
    }
    return SecureDraftStore('pos.draft.$scope');
  }
}

class FileDraftStore implements DraftStore {
  FileDraftStore(this.path);
  final String path;
  @override
  Future<String?> read() async {
    final file = File(path);
    return await file.exists() ? file.readAsString() : null;
  }
  @override
  Future<void> write(String data) async {
    final file = File(path);
    await file.parent.create(recursive: true);
    // write then rename, so a power cut mid-write never leaves half a cart
    final temp = File('$path.tmp');
    await temp.writeAsString(data, flush: true);
    await temp.rename(path);
  }
  @override
  Future<void> clear() async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }
}

class SecureDraftStore implements DraftStore {
  SecureDraftStore(this.key);
  final String key;
  static const _storage = FlutterSecureStorage();
  @override
  Future<String?> read() => _storage.read(key: key);
  @override
  Future<void> write(String data) => _storage.write(key: key, value: data);
  @override
  Future<void> clear() => _storage.delete(key: key);
}

/// Keeps drafts in memory: tests, and the demo.
class MemoryDraftStore implements DraftStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String data) async => value = data;
  @override
  Future<void> clear() async => value = null;
}
