import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

import '../core/errors.dart';
import '../db/db.dart';
import 'auth.dart';

String _hashToken(String token) => sha256.convert(utf8.encode(token)).toString();

String _randomHex(int bytes) {
  final random = Random.secure();

  return [for (var i = 0; i < bytes; i++) random.nextInt(256).toRadixString(16).padLeft(2, '0')].join();
}

class IssuedDeviceToken {
  const IssuedDeviceToken(this.id, this.token);

  final int id;

  /// The plaintext token - returned once, never stored, never retrievable again.
  final String token;
}

/// A device token is 256 random bits, only ever exact-matched, so a plain sha256 is
/// enough - bcrypt's deliberate slowness would only slow every request from every
/// paired device, for no security gain.
IssuedDeviceToken issueDeviceToken(Db db, {required int userId, String? namaPerangkat}) {
  final token = _randomHex(32);
  final now = nowSeconds();
  final id = db.insert(
    'INSERT INTO device_tokens (user_id, nama_perangkat, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [userId, namaPerangkat, _hashToken(token), now, now],
  );

  return IssuedDeviceToken(id, token);
}

/// The device's user, or null when the token is unknown or has been revoked.
AuthUser? resolveDeviceToken(Db db, String token) {
  final row = db.first(
    'SELECT t.id AS token_id, u.id, u.username, u.name, u.role '
    'FROM device_tokens t JOIN users u ON u.id = t.user_id '
    'WHERE t.token_hash = ? AND t.revoked_at IS NULL',
    [_hashToken(token)],
  );

  if (row == null) {
    return null;
  }

  db.execute('UPDATE device_tokens SET last_used_at = ? WHERE id = ?', [nowSeconds(), row['token_id']]);

  return AuthUser.fromRow(row);
}

String? _iso(Object? seconds) => seconds == null ? null : fromEpochSeconds(seconds as int).toIso8601String();

/// Every paired device, active and revoked alike.
List<Map<String, Object?>> listPairedDevices(Db db) {
  return [
    for (final row in db.select(
      'SELECT t.id, t.nama_perangkat, t.user_id, u.name AS user_name, t.created_at, t.last_used_at, t.revoked_at '
      'FROM device_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.created_at, t.id',
    ))
      {
        'id': row['id'],
        'namaPerangkat': row['nama_perangkat'],
        'userId': row['user_id'],
        'userName': row['user_name'],
        'createdAt': _iso(row['created_at']),
        'lastUsedAt': _iso(row['last_used_at']),
        'revokedAt': _iso(row['revoked_at']),
      },
  ];
}

void revokeDevice(Db db, int id) {
  if (db.first('SELECT id FROM device_tokens WHERE id = ?', [id]) == null) {
    throw BusinessException('Perangkat tidak ditemukan.');
  }

  db.execute('UPDATE device_tokens SET revoked_at = ? WHERE id = ?', [nowSeconds(), id]);
}

/// Revokes the token the caller is using - "logout" for a device.
void revokeToken(Db db, String token) {
  db.execute('UPDATE device_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [nowSeconds(), _hashToken(token)]);
}
