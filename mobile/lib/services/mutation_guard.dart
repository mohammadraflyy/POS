import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'mobile_api.dart';
abstract class PendingStore {
  Future<String?> read();
  Future<void> write(String data);
  Future<void> clear();
}
class SecurePendingStore implements PendingStore {
  SecurePendingStore(String scope): key = 'pos.pending.${base64Url.encode(utf8.encode(scope))}';
  final String key;
  static const storage = FlutterSecureStorage();
  @override Future<String?> read() => storage.read(key: key);
  @override Future<void> write(String data) => storage.write(key: key, value: data);
  @override Future<void> clear() => storage.delete(key: key);
}
/// Never retry a commit automatically: the contract has no idempotency key.
class MutationGuard extends ChangeNotifier {
  MutationGuard(this.store);
  final PendingStore store;
  Map<String, dynamic>? pending;
  bool ready = false, busy = false;
  String? error;
  bool _closed = false;
  void _emit() { if (!_closed) notifyListeners(); }
  Future<void> load() async {
    try { final saved = await store.read(); pending = saved == null ? null : jsonDecode(saved) as Map<String, dynamic>; ready = true; error = null; }
    catch (_) { error = 'Status transaksi perangkat belum dapat dibaca. Coba lagi sebelum menyimpan transaksi.'; }
    _emit();
  }
  Future<T> run<T>(String operation, Future<T> Function() commit) async {
    if (!ready || busy || pending != null) throw const ApiFailure('Periksa status transaksi sebelumnya sebelum melanjutkan.');
    busy = true; _emit();
    try {
      final marker = {'operation': operation, 'time': DateTime.now().toIso8601String()};
      await store.write(jsonEncode(marker));
      pending = marker;
      T result;
      try { result = await commit(); }
      catch (e) {
        if (e is ApiFailure && [400, 401, 404].contains(e.statusCode)) {
          await _clear();
          rethrow;
        }
        throw ApiFailure('$e\nHasil penyimpanan belum dapat dipastikan. Periksa riwayat atau aplikasi PC sebelum membuat transaksi lagi.');
      }
      await _clear();
      return result;
    } finally { busy = false; _emit(); }
  }
  Future<void> _clear() async {
    try { await store.clear(); pending = null; }
    catch (_) { error = 'Data sudah diproses, tetapi catatan status lokal belum dapat dibersihkan. Periksa PC sebelum melanjutkan.'; }
  }
  Future<void> acknowledgeChecked() async {
    if (busy) return;
    await store.clear(); pending = null; error = null; _emit();
  }
  @override void dispose() { _closed = true; super.dispose(); }
}
