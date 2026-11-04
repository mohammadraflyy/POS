import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import '../lib/services/mobile_api.dart';
import '../lib/services/session_storage.dart';
import '../lib/state/app_state.dart';
import 'mobile_api_test.dart' show FakeTransport;
class MemoryStorage implements SessionStorage {
  String? value;
  @override Future<String?> read() async => value;
  @override Future<void> write(String value) async { this.value = value; }
  @override Future<void> clear() async { value = null; }
}
void main() {
  test('legacy saved session with version still handles token revocation', () async {
    final storage = MemoryStorage()..value = jsonEncode({'address':'http://192.168.1.5:48950', 'version':'1.2.3', 'token':'example-token'});
    final app = AppState(api: MobileApi(transport: FakeTransport([const ApiResponse(401, {})])), storage: storage);
    await app.restore();
    expect(app.mode, AppMode.pairing); expect(storage.value, isNull); expect(app.initializing, false);
    app.dispose();
  });
  test('demo cannot cause HTTP checkout or write secure session', () async {
    final transport = FakeTransport([]); final storage = MemoryStorage();
    final app = AppState(api: MobileApi(transport: transport), storage: storage)..startDemo();
    app.add(app.demo.products.first);
    expect(app.cart.length, 1); expect(transport.calls, isEmpty); expect(storage.value, isNull);
    app.dispose();
  });
  test('business route 401 clears session and returns to pairing', () async {
    final storage = MemoryStorage()..value = jsonEncode({'address':'http://192.168.1.5:48950', 'token':'example-token'});
    final wire = FakeTransport([
      const ApiResponse(200, {'user': {'id': 2, 'username': 'kasir', 'name': 'Kasir', 'role': 'kasir'}}),
      const ApiResponse(401, {'error': 'Unauthorized'}),
    ]);
    final app = AppState(api: MobileApi(transport: wire), storage: storage);
    await app.restore(); expect(app.mode, AppMode.connected);
    await expectLater(app.businessRequest('/v1/catalog/search', method: 'GET'), throwsA(isA<ApiFailure>()));
    expect(app.mode, AppMode.pairing); expect(storage.value, isNull); app.dispose();
  });

}
