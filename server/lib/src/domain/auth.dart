import 'package:bcrypt/bcrypt.dart';

import '../core/errors.dart';
import '../db/db.dart';

enum UserRole {
  admin,
  kasir;

  static UserRole parse(Object? value) {
    if (value == 'admin') {
      return UserRole.admin;
    }

    if (value == 'kasir') {
      return UserRole.kasir;
    }

    throw BusinessException('Role harus admin atau kasir.');
  }
}

class AuthUser {
  const AuthUser({required this.id, required this.username, required this.name, required this.role});

  factory AuthUser.fromRow(Row row) => AuthUser(
        id: row['id'] as int,
        username: row['username'] as String,
        name: row['name'] as String,
        role: UserRole.parse(row['role']),
      );

  final int id;
  final String username;
  final String name;
  final UserRole role;

  bool get isAdmin => role == UserRole.admin;

  Map<String, Object?> toJson() => {'id': id, 'username': username, 'name': name, 'role': role.name};
}

AuthUser assertAdmin(AuthUser user) {
  if (!user.isAdmin) {
    throw ForbiddenException('Akses ditolak. Hanya admin yang boleh melakukan ini.');
  }

  return user;
}

/// Hashes are bcrypt with cost 10, the same as the desktop app's bcryptjs, so an
/// imported `users` table keeps working with the passwords people already know.
String hashPassword(String password) => BCrypt.hashpw(password, BCrypt.gensalt(logRounds: 10));

AuthUser verifyLogin(Db db, String username, String password) {
  final row = db.first('SELECT * FROM users WHERE username = ?', [username.trim().toLowerCase()]) ??
      db.first('SELECT * FROM users WHERE username = ?', [username]);

  if (row == null || !_checkPassword(password, row['password_hash'] as String)) {
    throw UnauthorizedException('Username atau password salah');
  }

  return AuthUser.fromRow(row);
}

bool _checkPassword(String password, String hash) {
  try {
    return BCrypt.checkpw(password, hash);
  } on Object {
    return false;
  }
}

/// A fresh database gets one admin/admin account, so the shop can sign in and set up
/// real users. Does nothing once any user exists - an imported database brings its own.
void seedDefaultAdmin(Db db) {
  final count = db.scalar<int>('SELECT count(*) FROM users') ?? 0;

  if (count > 0) {
    return;
  }

  final now = nowSeconds();

  db.insert(
    'INSERT INTO users (username, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['admin', hashPassword('admin'), 'Admin', 'admin', now, now],
  );
}
