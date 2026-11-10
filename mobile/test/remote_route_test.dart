import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import '../lib/services/mobile_api.dart';
import '../lib/services/tailnet_client.dart';
import '../lib/state/app_state.dart';
import 'session_test.dart' show MemoryStorage;

/// posnet, without the process: a fixed local port, and a "joined" the test fires.
class FakeTailnet implements TailnetClient {
  final starts = <({String target, String hostname, String? authKey})>[];
  final stops = <bool>[];
  final _joined = StreamController<void>.broadcast();
  @override bool get supported => true;
  @override Stream<void> get joined => _joined.stream;
  @override Future<int> start({required String target, required String hostname, String? authKey}) async {
    starts.add((target: target, hostname: hostname, authKey: authKey));
    return 5555;
  }
  @override Future<void> stop({bool forget = false}) async => stops.add(forget);
  void join() => _joined.add(null);
}

/// The shop PC as the phone sees it: on the Wi-Fi (192.168.1.5) unless that is switched
/// off, and through posnet (127.0.0.1:5555) whenever the phone is on the tailnet.
class ShopNetwork implements JsonTransport {
  bool wifi = true;
  bool remoteEnabled = true, remoteOnline = true;
  String remoteAddress = '100.64.0.7:48950';
  int grants = 0;
  final calls = <(String, Uri)>[];
  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async {
    calls.add((method, uri));
    if (uri.host == '192.168.1.5' && !wifi) {
      throw const ApiFailure('Tidak dapat terhubung ke PC.', unreachable: true);
    }
    return switch (uri.path) {
      '/v1/me' => const ApiResponse(200, {'user': {'id': 2, 'username': 'kasir', 'name': 'Kasir', 'role': 'kasir'}}),
      '/v1/health' => const ApiResponse(200, {'ok': true}),
      '/v1/server/status' => ApiResponse(200, {'running': true, 'address': '192.168.1.5', 'port': 48950,
        'remote': {'enabled': remoteEnabled, 'online': remoteOnline, 'address': remoteEnabled ? remoteAddress : null}}),
      '/v1/remote-access/grant' => ApiResponse(200, {'address': remoteAddress, 'authKey': 'tskey-auth-${++grants}'}),
      '/v1/catalog/search' => const ApiResponse(200, {'data': []}),
      '/v1/sales' => const ApiResponse(500, {'error': 'Terjadi kesalahan di server.'}),
      _ => const ApiResponse(404, {'error': 'Endpoint tidak ditemukan.'}),
    };
  }
  List<String> hostsFor(String path) => [for (final c in calls) if (c.$2.path == path) c.$2.authority];
}

void main() {
  late ShopNetwork network;
  late FakeTailnet tailnet;
  late MemoryStorage storage;

  setUp(() {
    network = ShopNetwork();
    tailnet = FakeTailnet();
    storage = MemoryStorage()..value = jsonEncode({'address': 'http://192.168.1.5:48950', 'token': 'device-token', 'deviceName': 'HP Kasir 1'});
  });

  Future<AppState> restored() async {
    final app = AppState(api: MobileApi(transport: network), storage: storage, tailnet: tailnet);
    await app.restore();
    await pumpEventQueue();
    return app;
  }

  Map<String, dynamic> saved() => jsonDecode(storage.value!) as Map<String, dynamic>;

  test('on the shop Wi-Fi the phone asks for its way in and joins right away', () async {
    final app = await restored();

    expect(network.grants, 1);
    expect(app.remoteAddress, '100.64.0.7:48950');
    expect(app.hasRemoteAccess, isTrue);
    expect(app.viaInternet, isFalse);
    expect(tailnet.starts.single, (target: '100.64.0.7:48950', hostname: 'pos-hp-hp-kasir-1', authKey: 'tskey-auth-1'));
    expect(saved()['remote'], containsPair('authKey', 'tskey-auth-1'));

    // once posnet is on the tailnet the key is spent: it is not kept
    tailnet.join();
    await pumpEventQueue();
    expect(saved()['remote'], allOf(containsPair('joined', true), containsPair('authKey', null)));

    // and the next check does not ask again
    await app.checkConnection();
    expect(network.grants, 1);
    app.dispose();
  });

  test('away from the Wi-Fi, requests go over the internet; back on it, the short way again', () async {
    final app = await restored();
    tailnet.join();
    await pumpEventQueue();

    network.wifi = false;
    await app.businessRequest('/v1/catalog/search', method: 'GET');
    expect(network.hostsFor('/v1/catalog/search'), ['192.168.1.5:48950', '127.0.0.1:5555']);
    expect(app.viaInternet, isTrue);
    expect(tailnet.starts.last.authKey, isNull);

    // while away it does not knock on the Wi-Fi address first
    await app.businessRequest('/v1/catalog/search', method: 'GET');
    expect(network.hostsFor('/v1/catalog/search').last, '127.0.0.1:5555');
    expect(network.hostsFor('/v1/catalog/search'), hasLength(3));

    network.wifi = true;
    await app.checkConnection();
    expect(app.viaInternet, isFalse);
    await app.businessRequest('/v1/catalog/search', method: 'GET');
    expect(network.hostsFor('/v1/catalog/search').last, '192.168.1.5:48950');
    app.dispose();
  });

  test('a request the PC did receive is never sent a second time', () async {
    final app = await restored();

    await expectLater(app.businessRequest('/v1/sales', method: 'POST', body: {}), throwsA(isA<ApiFailure>()));
    expect(network.hostsFor('/v1/sales'), ['192.168.1.5:48950']);
    app.dispose();
  });

  test('a phone the PC never gave a way in stays on the Wi-Fi', () async {
    network.remoteEnabled = false;
    final app = await restored();
    network.wifi = false;

    await expectLater(app.businessRequest('/v1/catalog/search', method: 'GET'), throwsA(isA<ApiFailure>()));
    expect(tailnet.starts, isEmpty);
    app.dispose();
  });

  test('the PC switching it off makes the phone forget its tailnet identity', () async {
    final app = await restored();
    network.remoteEnabled = false;

    await app.checkConnection();

    expect(app.remoteAddress, isNull);
    expect(tailnet.stops, [true]);
    expect(saved().containsKey('remote'), isFalse);
    app.dispose();
  });

  test('a PC that joined anew hands out a new way in, and the phone joins anew', () async {
    final app = await restored();
    tailnet.join();
    await pumpEventQueue();

    network.remoteAddress = '100.64.0.9:48950';
    await app.checkConnection();

    expect(tailnet.stops, [true]);
    expect(app.remoteAddress, '100.64.0.9:48950');
    expect(tailnet.starts.last, (target: '100.64.0.9:48950', hostname: 'pos-hp-hp-kasir-1', authKey: 'tskey-auth-2'));
    app.dispose();
  });

  test('a key that went stale before the phone could join is replaced', () async {
    final app = AppState(api: MobileApi(transport: network), storage: storage, tailnet: tailnet, keyLifetime: Duration.zero);
    await app.restore();
    await pumpEventQueue();
    expect(network.grants, 1);

    await app.checkConnection();
    expect(network.grants, 2);
    app.dispose();
  });

  test('logging out leaves the tailnet too', () async {
    final app = await restored();

    await app.logout();

    expect(tailnet.stops, [true]);
    expect(app.hasRemoteAccess, isFalse);
    expect(storage.value, isNull);
    app.dispose();
  });

  test('an older PC without remote access changes nothing', () async {
    final old = _OldServer();
    final app = AppState(api: MobileApi(transport: old), storage: storage, tailnet: tailnet);
    await app.restore();
    await pumpEventQueue();

    expect(app.mode, AppMode.connected);
    expect(tailnet.starts, isEmpty);
    app.dispose();
  });
}

class _OldServer implements JsonTransport {
  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async => switch (uri.path) {
    '/v1/me' => const ApiResponse(200, {'user': {'id': 2, 'username': 'kasir', 'name': 'Kasir', 'role': 'kasir'}}),
    '/v1/server/status' => const ApiResponse(200, {'running': true, 'address': '192.168.1.5', 'port': 48950}),
    _ => const ApiResponse(404, {'error': 'Endpoint tidak ditemukan.'}),
  };
}
