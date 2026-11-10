import 'dart:convert';

import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../core/errors.dart';
import '../db/db.dart';
import '../domain/attempt_limiter.dart';
import '../domain/auth.dart';
import '../domain/device_tokens.dart';
import '../domain/pairing.dart';
import '../printing/receipts.dart';
import '../remote/remote_access.dart';
import '../version.dart';

/// Everything a route needs, built once at startup.
class ApiContext {
  ApiContext({
    required this.db,
    required this.pairing,
    required this.receipts,
    required this.serverAddress,
    required this.port,
    this.remote,
    AttemptLimiter? logins,
  }) : logins = logins ?? AttemptLimiter();

  final Db db;
  final PairingCodes pairing;
  final ReceiptService receipts;

  /// Access from outside the shop; null on a server that never offers it.
  final RemoteAccess? remote;

  /// Wrong passwords per username, so nobody can keep guessing from the internet.
  final AttemptLimiter logins;

  /// The LAN address phones should reach, or null when the PC is on no network.
  final String? Function() serverAddress;
  final int port;
}

const _jsonHeaders = {'content-type': 'application/json; charset=utf-8'};

Response json(Object? body, {int status = 200}) => Response(status, body: jsonEncode(body), headers: _jsonHeaders);

Response ok([Map<String, Object?> body = const {'ok': true}]) => json(body);

Response file(List<int> bytes, String fileName, String contentType) => Response.ok(
      bytes,
      headers: {'content-type': contentType, 'content-disposition': 'attachment; filename="$fileName"'},
    );

/// Maps what a handler throws onto the status codes the clients rely on: a business
/// rejection is 400 with its message shown as-is, 401 sends a device back to pairing,
/// 403 is a kasir asking for an admin action, and anything else is a 500.
Middleware errorMapper({void Function(Object error, StackTrace stack)? onUnexpected}) {
  return (inner) => (request) async {
        try {
          return await inner(request);
        } on BusinessException catch (error) {
          return json({'error': error.message}, status: 400);
        } on UnauthorizedException catch (error) {
          return json({'error': error.message}, status: 401);
        } on ForbiddenException catch (error) {
          return json({'error': error.message}, status: 403);
        } on NotFoundException catch (error) {
          return json({'error': error.message}, status: 404);
        } on TooManyAttemptsException catch (error) {
          return json({'error': error.message}, status: 429);
        } on BadRequest catch (error) {
          return json({'error': error.message}, status: 400);
        } on Object catch (error, stack) {
          onUnexpected?.call(error, stack);

          return json({'error': 'Terjadi kesalahan di server.'}, status: 500);
        }
      };
}

/// A malformed request: missing fields, wrong types, unreadable JSON.
class BadRequest implements Exception {
  BadRequest(this.message);

  final String message;
}

String? _bearer(Request request) {
  final header = request.headers['authorization'];

  if (header == null || !header.startsWith('Bearer ')) {
    return null;
  }

  final token = header.substring('Bearer '.length).trim();

  return token.isEmpty ? null : token;
}

/// The signed-in user behind the request's device token.
AuthUser requireUser(ApiContext ctx, Request request) {
  final token = _bearer(request);

  if (token == null) {
    throw UnauthorizedException('Token tidak ditemukan.');
  }

  final user = resolveDeviceToken(ctx.db, token);

  if (user == null) {
    throw UnauthorizedException('Token tidak valid atau sudah dicabut.');
  }

  return user;
}

AuthUser requireAdmin(ApiContext ctx, Request request) => assertAdmin(requireUser(ctx, request));

String? bearerToken(Request request) => _bearer(request);

/// The request body as a JSON object; an empty body reads as `{}`.
Future<Map<String, Object?>> readJson(Request request) async {
  final text = await request.readAsString();

  if (text.trim().isEmpty) {
    return {};
  }

  try {
    final decoded = jsonDecode(text);

    if (decoded is Map<String, Object?>) {
      return decoded;
    }
  } on FormatException {
    // fall through
  }

  throw BadRequest('Body harus berupa JSON object.');
}

// --- typed field readers -------------------------------------------------------

extension JsonFields on Map<String, Object?> {
  num? numOr(String key) {
    final value = this[key];

    if (value == null) {
      return null;
    }

    if (value is num) {
      return value;
    }

    throw BadRequest('$key harus berupa angka.');
  }

  num number(String key) => numOr(key) ?? (throw BadRequest('$key wajib diisi.'));

  int? intOr(String key) {
    final value = numOr(key);

    if (value == null) {
      return null;
    }

    if (value != value.roundToDouble()) {
      throw BadRequest('$key harus berupa bilangan bulat.');
    }

    return value.toInt();
  }

  int integer(String key) => intOr(key) ?? (throw BadRequest('$key wajib diisi.'));

  String? stringOr(String key) {
    final value = this[key];

    if (value == null) {
      return null;
    }

    if (value is String) {
      return value;
    }

    throw BadRequest('$key harus berupa teks.');
  }

  String string(String key) => stringOr(key) ?? (throw BadRequest('$key wajib diisi.'));

  bool? boolOr(String key) {
    final value = this[key];

    if (value == null || value is bool) {
      return value as bool?;
    }

    throw BadRequest('$key harus true atau false.');
  }

  List<Map<String, Object?>> objects(String key) {
    final value = this[key];

    if (value is! List || value.any((item) => item is! Map)) {
      throw BadRequest('$key wajib berupa daftar.');
    }

    return [for (final item in value) (item as Map).cast<String, Object?>()];
  }

  List<int> ints(String key) {
    final value = this[key];

    if (value is! List || value.any((item) => item is! num)) {
      throw BadRequest('$key wajib berupa daftar angka.');
    }

    return [for (final item in value) (item as num).toInt()];
  }

  bool has(String key) => containsKey(key);
}

extension QueryParams on Request {
  String? query(String key) {
    final value = url.queryParameters[key];

    return value == null || value.isEmpty ? null : value;
  }

  int queryInt(String key, {int fallback = 1}) => int.tryParse(url.queryParameters[key] ?? '') ?? fallback;

  int? queryIntOr(String key) => int.tryParse(url.queryParameters[key] ?? '');
}

int pathInt(Request request, String name) {
  final value = int.tryParse(request.params[name] ?? '');

  if (value == null) {
    throw NotFoundException('Data tidak ditemukan.');
  }

  return value;
}

Map<String, Object?> withVersion(Map<String, Object?> body) => {...body, 'appVersion': appVersion};
