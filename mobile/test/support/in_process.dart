import 'dart:convert';

import 'package:shelf/shelf.dart' as shelf;

import '../../lib/services/mobile_api.dart';

/// Sends the app's requests straight into the server's handler, no sockets.
class InProcessTransport implements JsonTransport {
  InProcessTransport(this.handler);
  final shelf.Handler handler;
  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async {
    final response = await handler(shelf.Request(method, Uri.parse('http://localhost${uri.path}${uri.hasQuery ? '?${uri.query}' : ''}'),
      headers: headers, body: body == null ? null : jsonEncode(body)));
    final text = await response.readAsString();
    return ApiResponse(response.statusCode, text.isEmpty ? null : jsonDecode(text));
  }
}

