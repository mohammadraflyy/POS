import 'package:flutter_test/flutter_test.dart';
import '../lib/services/mobile_api.dart';
class FakeTransport implements JsonTransport {
  FakeTransport(this.responses);
  final List<ApiResponse> responses;
  final List<(String, Uri, Map<String, String>, Map<String, dynamic>?)> calls = [];
  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async {
    calls.add((method, uri, headers, body)); return responses.removeAt(0);
  }
}
void main() {
  test('QR contract is address/code and keeps leading zero in pairing code', () {
    final qr = PairingQr.parse('{"address":"192.168.1.5:48950","code":"012345"}');
    expect(qr.address, 'http://192.168.1.5:48950'); expect(qr.code, '012345');
    expect(() => PairingQr.parse('{"code":12345}'), throwsA(isA<ApiFailure>()));
    expect(() => parseAddress('http://user:pass@192.168.1.5'), throwsA(isA<ApiFailure>()));
  });
  test('only documented pairing fields sent, token attached to me', () async {
    final transport = FakeTransport([
      const ApiResponse(200, {'token': 'example-token', 'appVersion': '1.2.3'}),
      const ApiResponse(200, {'user': {'username': 'kasir'}, 'appVersion': '1.2.3'}),
    ]);
    final api = MobileApi(transport: transport); final base = parseAddress('192.168.1.5');
    await api.pair(base, '123456', 'kasir', 'not-a-real-password', 'Tablet');
    await api.me(base, 'example-token');
    expect(transport.calls.first.$2.path, '/v1/pair');
    expect(transport.calls.first.$4!['pairingCode'], '123456');
    expect(transport.calls.last.$3['Authorization'], 'Bearer example-token');
  });
  test('server version is informational and does not block health', () async {
    final api = MobileApi(transport: FakeTransport([const ApiResponse(200, {'ok': true, 'appVersion': '9.9.9'}), const ApiResponse(200, {'ok': true})]));
    final base = parseAddress('192.168.1.5');
    await api.health(base);
    await api.health(base);
  });
  test('401 stays unauthorized even if version is absent or mismatched', () async {
    final api = MobileApi(transport: FakeTransport([const ApiResponse(401, {'error': 'Unauthorized', 'appVersion': 'different'})]));
    await expectLater(api.me(parseAddress('192.168.1.5'), 'token'), throwsA(isA<ApiFailure>().having((e) => e.unauthorized, 'unauthorized', true)));
  });
  test('500 business message is preserved when version missing', () async {
    final api = MobileApi(transport: FakeTransport([const ApiResponse(500, {'error': 'Pesan dari server'})]));
    await expectLater(api.health(parseAddress('192.168.1.5')), throwsA(isA<ApiFailure>().having((e) => e.message, 'message', 'Pesan dari server')));
  });
}
