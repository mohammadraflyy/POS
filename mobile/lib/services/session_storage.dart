import 'package:flutter_secure_storage/flutter_secure_storage.dart';
abstract class SessionStorage {
  Future<String?> read();
  Future<void> write(String value);
  Future<void> clear();
}
class SecureSessionStorage implements SessionStorage {
  static const _storage = FlutterSecureStorage();
  static const _key = 'pos.mobile.device.session.v1';
  @override
  Future<String?> read() => _storage.read(key: _key);
  @override
  Future<void> write(String value) => _storage.write(key: _key, value: value);
  @override
  Future<void> clear() => _storage.delete(key: _key);
}
