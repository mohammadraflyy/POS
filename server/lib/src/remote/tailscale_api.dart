import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../core/errors.dart';

/// One HTTP POST, injectable so tests never reach the internet.
typedef HttpPost = Future<({int status, String body})> Function(Uri uri, Map<String, String> headers, String body);

/// The tag every POS device joins the tailnet with. Tagged devices never need their key
/// renewed, which is what lets a phone keep working for years without anyone logging in.
const posTag = 'tag:pos';

/// The slice of the Tailscale API the shop needs: turn the shop's OAuth client (the
/// "kunci admin") into single-use auth keys, one per device that joins.
class TailscaleApi {
  TailscaleApi({HttpPost? post, Uri? baseUrl})
      : _post = post ?? _ioPost,
        _base = baseUrl ?? Uri.parse('https://api.tailscale.com');

  final HttpPost _post;
  final Uri _base;

  /// A fresh auth key that lets exactly one device join, tagged [posTag], valid for an
  /// hour - long enough for a phone to start up, useless if it leaks later.
  Future<String> mintAuthKey({required String clientId, required String clientSecret, required String description}) async {
    final token = await _accessToken(clientId, clientSecret);
    final response = await _send(
      _base.resolve('/api/v2/tailnet/-/keys'),
      {'authorization': 'Bearer $token', 'content-type': 'application/json'},
      jsonEncode({
        'capabilities': {
          'devices': {
            'create': {
              'reusable': false,
              'ephemeral': false,
              'preauthorized': true,
              'tags': [posTag],
            },
          },
        },
        'expirySeconds': 3600,
        'description': keyDescription(description),
      }),
    );

    if (response.status == 400 || response.status == 403) {
      throw BusinessException(
        'Kunci admin belum punya izin membuat perangkat dengan $posTag. Saat membuat kunci, centang "Auth Keys: Write" dan pilih tag $posTag.',
      );
    }

    final key = _decode(response)['key'];

    if (key is! String || !key.startsWith('tskey-')) {
      throw BusinessException('Jawaban Tailscale tidak dikenali. Coba lagi beberapa saat lagi.');
    }

    return key;
  }

  Future<String> _accessToken(String clientId, String clientSecret) async {
    final response = await _send(
      _base.resolve('/api/v2/oauth/token'),
      {'content-type': 'application/x-www-form-urlencoded'},
      Uri(queryParameters: {'client_id': clientId, 'client_secret': clientSecret, 'grant_type': 'client_credentials'}).query,
    );

    if (response.status == 400 || response.status == 401) {
      throw BusinessException('Kunci admin Tailscale salah. Periksa Client ID dan Client Secret, lalu tempel ulang.');
    }

    final token = _decode(response)['access_token'];

    if (token is! String || token.isEmpty) {
      throw BusinessException('Jawaban Tailscale tidak dikenali. Coba lagi beberapa saat lagi.');
    }

    return token;
  }

  Future<({int status, String body})> _send(Uri uri, Map<String, String> headers, String body) async {
    try {
      return await _post(uri, headers, body).timeout(const Duration(seconds: 20));
    } on TimeoutException {
      throw BusinessException('Tailscale tidak menjawab. Periksa internet PC toko.');
    } on SocketException {
      throw BusinessException('Tidak bisa menghubungi Tailscale. Periksa internet PC toko.');
    }
  }

  Map<String, Object?> _decode(({int status, String body}) response) {
    if (response.status < 200 || response.status >= 300) {
      throw BusinessException('Tailscale menolak permintaan (${response.status}). Coba lagi beberapa saat lagi.');
    }

    try {
      final decoded = jsonDecode(response.body);

      if (decoded is Map<String, Object?>) {
        return decoded;
      }
    } on FormatException {
      // fall through
    }

    throw BusinessException('Jawaban Tailscale tidak dikenali. Coba lagi beberapa saat lagi.');
  }
}

/// Tailscale takes up to 50 letters, digits, spaces and dashes as a key's description.
String keyDescription(String text) {
  final cleaned = text.replaceAll(RegExp(r'[^A-Za-z0-9 -]'), '').trim();
  final fallback = cleaned.isEmpty ? 'POS' : cleaned;

  return fallback.length > 50 ? fallback.substring(0, 50).trim() : fallback;
}

Future<({int status, String body})> _ioPost(Uri uri, Map<String, String> headers, String body) async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);

  try {
    final request = await client.postUrl(uri);
    headers.forEach(request.headers.set);
    request.write(body);
    final response = await request.close();

    return (status: response.statusCode, body: await response.transform(utf8.decoder).join());
  } finally {
    client.close(force: true);
  }
}
