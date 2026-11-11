import 'dart:async';
import 'dart:convert';
import 'dart:io';

class ApiFailure implements Exception {
  const ApiFailure(this.message, {this.unauthorized = false, this.statusCode, this.unreachable = false});
  final String message;
  final bool unauthorized;
  final int? statusCode;
  /// The PC was never reached - no connection was made, so nothing was sent and the
  /// request is safe to repeat by another way (the internet instead of the Wi-Fi).
  final bool unreachable;
  @override
  String toString() => message;
}
class ApiResponse {
  const ApiResponse(this.status, this.body);
  final int status;
  final Object? body;
}
abstract class JsonTransport {
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body);
}
class IoJsonTransport implements JsonTransport {
  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async {
    final isLocalTunnel = Platform.isAndroid && uri.host == '127.0.0.1';
    final connectTimeout = isLocalTunnel ? const Duration(seconds: 30) : const Duration(seconds: 6);
    final totalTimeout = isLocalTunnel ? const Duration(seconds: 45) : const Duration(seconds: 12);
    final client = HttpClient()..connectionTimeout = connectTimeout;
    var connected = false;
    try {
      return await (() async {
        final request = await client.openUrl(method, uri);
        if (!isLocalTunnel) connected = true;
        request.followRedirects = false;
        headers.forEach(request.headers.set);
        request.headers.contentType = ContentType.json;
        if (body != null) request.write(jsonEncode(body));
        final response = await request.close();
        connected = true;
        final bytes = <int>[];
        await for (final chunk in response) {
          bytes.addAll(chunk);
          if (bytes.length > 16 * 1024 * 1024) throw const ApiFailure('Respons PC terlalu besar.');
        }
        final parsed = jsonDecode(utf8.decode(bytes));
        return ApiResponse(response.statusCode, parsed);
      })().timeout(totalTimeout);
    } on TimeoutException {
      throw ApiFailure('PC belum merespons. Pastikan PC aktif dan berada di jaringan yang sama.', unreachable: !connected);
    } on SocketException {
      throw ApiFailure('Tidak dapat terhubung ke PC. Periksa alamat, Wi-Fi, dan firewall port 48950.', unreachable: !connected);
    } on HttpException {
      throw ApiFailure('Koneksi ke PC terputus. Silakan periksa jaringan.', unreachable: !connected);
    } on FormatException {
      throw const ApiFailure('Respons bukan JSON API mobile yang valid. Periksa alamat PC.');
    } finally {
      client.close(force: true);
    }
  }
}
Uri parseAddress(String input) {
  final raw = input.trim();
  final uri = Uri.tryParse(raw.contains('://') ? raw : 'http://$raw');
  if (uri == null || uri.scheme != 'http' || uri.host.isEmpty || uri.userInfo.isNotEmpty ||
      (uri.path.isNotEmpty && uri.path != '/') || uri.hasQuery || uri.hasFragment) {
    throw const ApiFailure('Gunakan alamat HTTP PC, contoh 192.168.1.5:48950.');
  }
  final port = uri.hasPort ? uri.port : 48950;
  if (port < 1 || port > 65535) throw const ApiFailure('Port tidak valid.');
  return Uri(scheme: 'http', host: uri.host, port: port);
}
class PairingQr {
  PairingQr(this.address, this.code);
  final String address, code;
  factory PairingQr.parse(String raw) {
    try {
      final data = jsonDecode(raw);
      if (data is! Map || data['address'] is! String || data['code'] is! String ||
          !RegExp(r'^\d{6}$').hasMatch(data['code'] as String)) {
        throw const FormatException();
      }
      return PairingQr(parseAddress(data['address'] as String).toString(), data['code'] as String);
    } catch (_) {
      throw const ApiFailure('QR pairing tidak valid. Scan QR dari Pengaturan > Perangkat Mobile di PC.');
    }
  }
}
class MobileApi {
  MobileApi({JsonTransport? transport, FileTransport? files}): transport = transport ?? IoJsonTransport(), files = files ?? IoFileTransport();
  final JsonTransport transport;
  final FileTransport files;
  Future<Object?> requestRaw({required Uri base, required String path,
    String method = 'GET', String? token, Map<String, String>? query,
    Map<String, dynamic>? body}) async {
    final uri = base.resolve(path).replace(queryParameters: query);
    final result = await transport.send(method, uri, {
      'Accept': 'application/json', if (token != null) 'Authorization': 'Bearer $token',
    }, body);
    if (result.status == 401) {
      final data = result.body;
      final serverMsg = data is Map && data['error'] != null ? data['error'].toString() : null;
      throw ApiFailure(serverMsg ?? (path == '/v1/pair'
        ? 'Pairing gagal. Kode atau akun tidak valid. Buat kode baru di PC lalu coba kembali.'
        : path == '/v1/auth/login'
          ? 'Username atau password salah.'
          : 'Akses perangkat sudah tidak valid. Hubungkan ulang perangkat dari PC.'),
        unauthorized: true, statusCode: 401);
    }
    if (result.status < 200 || result.status >= 300) {
      final data = result.body;
      throw ApiFailure(data is Map && data['error'] != null
        ? data['error'].toString() : 'Permintaan gagal (${result.status}).', statusCode: result.status);
    }
    return result.body;
  }
  Future<Map<String, dynamic>> request({required Uri base, required String path,
    String method = 'GET', String? token, Map<String, dynamic>? body}) async {
    final data = await requestRaw(base: base, path: path, method: method, token: token, body: body);
    if (data is! Map<String, dynamic>) throw const ApiFailure('Format respons PC tidak sesuai.');
    return data;
  }
  Future<void> health(Uri base) async {
    final response = await request(base: base, path: '/v1/health');
    if (response['ok'] != true) throw const ApiFailure('Layanan PC belum siap.');
  }
  Future<Map<String, dynamic>> pair(Uri base, String code, String username,
    String password, String deviceName) => request(base: base, path: '/v1/pair',
      method: 'POST', body: {'pairingCode': code, 'username': username, 'password': password, 'deviceName': deviceName});
  Future<Map<String, dynamic>> me(Uri base, String token) =>
    request(base: base, path: '/v1/me', token: token);
  /// Username + password sign-in, for the shop PC itself or an admin's own device.
  Future<Map<String, dynamic>> login(Uri base, String username, String password, String deviceName) => request(base: base,
    path: '/v1/auth/login', method: 'POST', body: {'username': username, 'password': password, 'deviceName': deviceName});
  /// Files in and out: Excel exports come down as bytes, imports go up as the raw file.
  Future<FileResponse> transferFile({required Uri base, required String path, String method = 'GET', String? token,
    Map<String, String>? query, List<int>? upload}) async {
    final uri = base.resolve(path).replace(queryParameters: query);
    final result = await files.send(method, uri, {if (token != null) 'Authorization': 'Bearer $token'}, upload);
    if (result.status == 401) throw const ApiFailure('Akses perangkat sudah tidak valid. Hubungkan ulang perangkat dari PC.', unauthorized: true, statusCode: 401);
    if (result.status < 200 || result.status >= 300) {
      String message = 'Permintaan gagal (${result.status}).';
      try { final data = jsonDecode(utf8.decode(result.bytes)); if (data is Map && data['error'] != null) message = data['error'].toString(); } catch (_) {}
      throw ApiFailure(message, statusCode: result.status);
    }
    return result;
  }
}
class FileResponse {
  const FileResponse(this.status, this.bytes, this.contentType);
  final int status;
  final List<int> bytes;
  final String? contentType;
  Object? get json => jsonDecode(utf8.decode(bytes));
}
abstract class FileTransport {
  Future<FileResponse> send(String method, Uri uri, Map<String, String> headers, List<int>? body);
}
class IoFileTransport implements FileTransport {
  @override
  Future<FileResponse> send(String method, Uri uri, Map<String, String> headers, List<int>? body) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    var connected = false;
    try {
      return await (() async {
        final request = await client.openUrl(method, uri);
        connected = true;
        headers.forEach(request.headers.set);
        if (body != null) { request.headers.contentType = ContentType.binary; request.add(body); }
        final response = await request.close();
        final bytes = <int>[];
        await for (final chunk in response) { bytes.addAll(chunk); }
        return FileResponse(response.statusCode, bytes, response.headers.contentType?.mimeType);
      })().timeout(const Duration(seconds: 60));
    } on TimeoutException {
      throw ApiFailure('PC belum merespons. Pastikan PC aktif dan berada di jaringan yang sama.', unreachable: !connected);
    } on SocketException {
      throw ApiFailure('Tidak dapat terhubung ke PC. Periksa alamat, Wi-Fi, dan firewall.', unreachable: !connected);
    } finally { client.close(force: true); }
  }
}
