import '../core/errors.dart';
import '../db/db.dart';
import 'auth.dart';

const _minPasswordLength = 4;

List<Map<String, Object?>> listUsers(Db db) {
  return [
    for (final row in db.select('SELECT id, username, name, role, created_at FROM users ORDER BY username'))
      {
        'id': row['id'],
        'username': row['username'],
        'name': row['name'],
        'role': row['role'],
        'createdAt': fromEpochSeconds(row['created_at'] as int).toIso8601String(),
      },
  ];
}

void _validatePassword(String password) {
  if (password.length < _minPasswordLength) {
    throw BusinessException('Password minimal $_minPasswordLength karakter.');
  }
}

/// Guards the shop against ending up with no one who can administer it.
void _assertNotLastAdmin(Db db, int userId) {
  final role = db.scalar<String>('SELECT role FROM users WHERE id = ?', [userId]);

  if (role != 'admin') {
    return;
  }

  final otherAdmins = db.scalar<int>("SELECT count(*) FROM users WHERE role = 'admin' AND id != ?", [userId]) ?? 0;

  if (otherAdmins == 0) {
    throw BusinessException('Admin terakhir tidak bisa dihapus atau diturunkan jadi kasir.');
  }
}

int createUser(Db db, {required String username, required String name, required String password, required UserRole role}) {
  final cleanUsername = username.trim().toLowerCase();
  final cleanName = name.trim();

  if (cleanUsername.isEmpty) {
    throw BusinessException('Username wajib diisi.');
  }

  if (cleanName.isEmpty) {
    throw BusinessException('Nama wajib diisi.');
  }

  _validatePassword(password);

  if (db.first('SELECT id FROM users WHERE username = ?', [cleanUsername]) != null) {
    throw BusinessException('Username sudah dipakai.');
  }

  final now = nowSeconds();

  return db.insert(
    'INSERT INTO users (username, name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [cleanUsername, cleanName, hashPassword(password), role.name, now, now],
  );
}

/// [password] null leaves the existing password alone.
void updateUser(Db db, int id, {required String name, required UserRole role, String? password}) {
  final existing = db.first('SELECT * FROM users WHERE id = ?', [id]);

  if (existing == null) {
    throw BusinessException('Pengguna tidak ditemukan.');
  }

  final cleanName = name.trim();

  if (cleanName.isEmpty) {
    throw BusinessException('Nama wajib diisi.');
  }

  if (existing['role'] == 'admin' && role != UserRole.admin) {
    _assertNotLastAdmin(db, id);
  }

  if (password != null) {
    _validatePassword(password);
    db.execute(
      'UPDATE users SET name = ?, role = ?, password_hash = ?, updated_at = ? WHERE id = ?',
      [cleanName, role.name, hashPassword(password), nowSeconds(), id],
    );
  } else {
    db.execute('UPDATE users SET name = ?, role = ?, updated_at = ? WHERE id = ?', [cleanName, role.name, nowSeconds(), id]);
  }
}

void deleteUser(Db db, int id, int currentUserId) {
  if (id == currentUserId) {
    throw BusinessException('Tidak bisa menghapus akun yang sedang dipakai.');
  }

  if (db.first('SELECT id FROM users WHERE id = ?', [id]) == null) {
    throw BusinessException('Pengguna tidak ditemukan.');
  }

  _assertNotLastAdmin(db, id);

  // sales, purchases and price histories reference users with ON DELETE SET NULL, so
  // removing an account leaves its past transactions in place, merely unattributed
  db.execute('DELETE FROM users WHERE id = ?', [id]);
}
