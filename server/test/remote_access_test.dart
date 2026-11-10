import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:pos_server/pos_server.dart';
import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/domain/attempt_limiter.dart';
import 'package:pos_server/src/domain/auth.dart';
import 'package:pos_server/src/domain/device_tokens.dart';
import 'package:pos_server/src/printing/printer.dart';
import 'package:pos_server/src/printing/receipts.dart';
import 'package:pos_server/src/remote/tailscale_api.dart';
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

/// Tailscale's API, answering from memory.
class FakeTailscale {
  final requests = <({Uri uri, Map<String, String> headers, String body})>[];
  int tokenStatus = 200;
  int keyStatus = 200;
  var _minted = 0;

  Future<({int status, String body})> post(Uri uri, Map<String, String> headers, String body) async {
    requests.add((uri: uri, headers: headers, body: body));

    if (uri.path == '/api/v2/oauth/token') {
      return (status: tokenStatus, body: jsonEncode({'access_token': 'access-1', 'token_type': 'Bearer'}));
    }

    return (status: keyStatus, body: jsonEncode({'key': 'tskey-auth-${++_minted}'}));
  }

  List<Map<String, Object?>> get keyRequests => [
        for (final request in requests)
          if (request.uri.path.endsWith('/keys')) jsonDecode(request.body) as Map<String, Object?>,
      ];
}

class FakeNode implements TailnetProcess {
  FakeNode(this.args, this.authKey);

  final List<String> args;
  final String? authKey;
  final _events = StreamController<Map<String, Object?>>.broadcast();
  final _exit = Completer<int>();
  bool killed = false;

  void emit(Map<String, Object?> event) => _events.add(event);

  void crash(int code) => _exit.complete(code);

  @override
  Stream<Map<String, Object?>> get events => _events.stream;

  @override
  Future<int> get exitCode => _exit.future;

  @override
  void kill() {
    killed = true;

    if (!_exit.isCompleted) {
      _exit.complete(0);
    }
  }
}

class Launcher {
  final nodes = <FakeNode>[];

  Future<TailnetProcess> call(List<String> args, {String? authKey}) async {
    final node = FakeNode(args, authKey);
    nodes.add(node);

    return node;
  }

  FakeNode get last => nodes.last;

  /// The PC's posnet comes up on the tailnet and starts accepting.
  Future<void> bringUp([String ip = '100.64.0.7']) async {
    last.emit({'event': 'up', 'ip': ip});
    last.emit({'event': 'serving', 'port': 48950});
    await pumpEventQueue();
  }
}

class _NoPrinter implements RawPrinter {
  @override
  Future<List<PrinterInfo>> listPrinters() async => [];

  @override
  Future<void> printRaw(String? printerName, List<int> bytes) async {}
}

final posnetExe = File('tailnet/dist/posnet${Platform.isWindows ? '.exe' : ''}');

void main() {
  late Directory dir;
  late Db db;
  late FakeTailscale tailscale;
  late Launcher launcher;
  late RemoteAccess remote;

  RemoteAccess build({Duration restartDelay = const Duration(seconds: 10)}) => RemoteAccess(
        db: db,
        launcher: launcher.call,
        api: TailscaleApi(post: tailscale.post),
        stateDir: '${dir.path}/tailnet',
        port: 48950,
        restartDelay: restartDelay,
      );

  setUp(() {
    dir = Directory.systemTemp.createTempSync('pos-remote-');
    db = seedDb();
    tailscale = FakeTailscale();
    launcher = Launcher();
    remote = build();
  });

  tearDown(() async {
    await remote.close();
    db.close();
    dir.deleteSync(recursive: true);
  });

  group('turning it on', () {
    test('checks the OAuth client by minting the PC its own key, then joins with it', () async {
      await remote.enable(clientId: ' client-1 ', clientSecret: ' tskey-client-secret ');

      final token = Uri(query: tailscale.requests.first.body).queryParameters;
      expect(token['client_id'], 'client-1');
      expect(token['client_secret'], 'tskey-client-secret');

      final key = tailscale.keyRequests.single;
      expect(tailscale.requests.last.headers['authorization'], 'Bearer access-1');
      expect(key['capabilities'], {
        'devices': {
          'create': {'reusable': false, 'ephemeral': false, 'preauthorized': true, 'tags': ['tag:pos']},
        },
      });
      expect(key['expirySeconds'], 3600);

      expect(launcher.last.authKey, 'tskey-auth-1');
      expect(launcher.last.args, ['-state', '${dir.path}/tailnet', '-hostname', 'pos-pc', '-tag', 'tag:pos', '-serve', '48950']);
      expect(remote.state, RemoteState.starting);

      await launcher.bringUp();

      expect(remote.status(), {'available': true, 'configured': true, 'state': 'online', 'address': '100.64.0.7:48950', 'message': null});
    });

    test('a wrong OAuth client is refused and nothing is saved or started', () async {
      tailscale.tokenStatus = 401;

      await expectLater(remote.enable(clientId: 'x', clientSecret: 'y'), throwsA(isA<BusinessException>().having((e) => e.message, 'message', contains('salah'))));

      expect(remote.isConfigured, isFalse);
      expect(launcher.nodes, isEmpty);
    });

    test('a client without permission to tag devices gets told what to tick', () async {
      tailscale.keyStatus = 403;

      await expectLater(remote.enable(clientId: 'x', clientSecret: 'y'), throwsA(isA<BusinessException>().having((e) => e.message, 'message', contains('Auth Keys'))));
      expect(remote.isConfigured, isFalse);
    });

    test('without posnet in this build it is unavailable', () async {
      final bare = RemoteAccess(db: db, stateDir: dir.path, port: 48950, api: TailscaleApi(post: tailscale.post));

      expect(bare.status()['available'], isFalse);
      await expectLater(bare.enable(clientId: 'x', clientSecret: 'y'), throwsA(isA<BusinessException>()));
    });
  });

  group('after a restart', () {
    test('rejoins with the saved identity, without a new key', () async {
      await remote.enable(clientId: 'c', clientSecret: 's');
      File('${dir.path}/tailnet/tailscaled.state').writeAsStringSync('{}');
      await remote.close();

      final again = build();
      await again.resume();

      expect(launcher.last.authKey, isNull);
      expect(tailscale.keyRequests, hasLength(1));
      await again.close();
    });

    test('mints a new key when the identity was lost', () async {
      await remote.enable(clientId: 'c', clientSecret: 's');
      await remote.close();

      final again = build();
      await again.resume();

      expect(launcher.last.authKey, 'tskey-auth-2');
      await again.close();
    });

    test('does nothing when it was never switched on', () async {
      await remote.resume();

      expect(launcher.nodes, isEmpty);
      expect(remote.state, RemoteState.off);
    });

    test('starts posnet again when it dies', () async {
      remote = build(restartDelay: const Duration(milliseconds: 10));
      await remote.enable(clientId: 'c', clientSecret: 's');
      await launcher.bringUp();

      launcher.last.emit({'event': 'error', 'message': 'jaringan Tailscale berhenti'});
      await pumpEventQueue();
      launcher.last.crash(1);
      await pumpEventQueue();

      expect(remote.state, RemoteState.failed);
      expect(remote.status()['message'], 'jaringan Tailscale berhenti');

      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(launcher.nodes, hasLength(2));
    });
  });

  group('phones', () {
    test('each phone gets the PC address and a key of its own', () async {
      await remote.enable(clientId: 'c', clientSecret: 's');
      await launcher.bringUp();

      final first = await remote.grant(deviceName: 'HP Kasir (Budi)');
      final second = await remote.grant(deviceName: 'HP Owner');

      expect(first, {'address': '100.64.0.7:48950', 'authKey': 'tskey-auth-2'});
      expect(second['authKey'], 'tskey-auth-3');
      expect(tailscale.keyRequests[1]['description'], 'POS HP HP Kasir Budi');
    });

    test('not before the PC is online', () async {
      await expectLater(remote.grant(deviceName: 'HP'), throwsA(isA<BusinessException>().having((e) => e.message, 'message', contains('belum diaktifkan'))));

      await remote.enable(clientId: 'c', clientSecret: 's');
      await expectLater(remote.grant(deviceName: 'HP'), throwsA(isA<BusinessException>().having((e) => e.message, 'message', contains('belum tersambung'))));
    });
  });

  test('turning it off leaves the tailnet and forgets the client', () async {
    await remote.enable(clientId: 'c', clientSecret: 's');
    await launcher.bringUp();
    final node = launcher.last;

    await remote.disable();

    expect(node.killed, isTrue);
    expect(remote.isConfigured, isFalse);
    expect(Directory('${dir.path}/tailnet').existsSync(), isFalse);
    expect(remote.status()['state'], 'off');
  });

  // the real posnet, when it has been built (tailnet/build.ps1): it starts, reports its
  // local port as JSON, and leaves when told to - no tailnet needed for that much
  test('the real posnet starts, reports its port, and stops', () async {
    final process = await processTailnetLauncher(posnetExe.absolute.path)(['-state', '${dir.path}/phone', '-hostname', 'test', '-dial', '100.100.100.100:48950']);
    final first = await process.events.first.timeout(const Duration(seconds: 20));

    expect(first['event'], 'listening');
    expect(first['port'], isA<int>());

    process.kill();
    expect(await process.exitCode.timeout(const Duration(seconds: 10)), 0);
  }, skip: posnetExe.existsSync() ? false : 'posnet belum dibuild (tailnet/build.ps1)');

  test('key descriptions keep to what Tailscale accepts', () {
    expect(keyDescription('HP Kasir (Budi) #1'), 'HP Kasir Budi 1');
    expect(keyDescription('***'), 'POS');
    expect(keyDescription('x' * 80), hasLength(50));
  });

  group('over HTTP', () {
    late Handler handler;
    late String adminToken;
    late String kasirToken;

    setUp(() {
      db.execute('UPDATE users SET password_hash = ? WHERE id = 1', [hashPassword('rahasia')]);
      db.insert("INSERT INTO users (id, username, password_hash, name, role, created_at, updated_at) VALUES (2, 'owner', ?, 'Pemilik', 'admin', 0, 0)", [hashPassword('admin123')]);
      final ctx = ApiContext(
        db: db,
        pairing: PairingCodes(),
        receipts: ReceiptService(db, _NoPrinter()),
        serverAddress: () => '192.168.1.5',
        port: 48950,
        remote: remote,
        logins: AttemptLimiter(maxFailures: 3),
      );
      handler = buildHandler(ctx);
      adminToken = issueDeviceToken(db, userId: 2).token;
      kasirToken = issueDeviceToken(db, userId: 1).token;
    });

    Future<({int status, dynamic body})> call(String method, String path, {Object? body, String? token}) async {
      final response = await handler(Request(
        method,
        Uri.parse('http://localhost$path'),
        headers: {if (token != null) 'authorization': 'Bearer $token'},
        body: body == null ? null : jsonEncode(body),
      ));

      return (status: response.statusCode, body: jsonDecode(await response.readAsString()));
    }

    test('only an admin sets it up', () async {
      expect((await call('PUT', '/v1/remote-access', token: kasirToken, body: {'clientId': 'c', 'clientSecret': 's'})).status, 403);

      final enabled = await call('PUT', '/v1/remote-access', token: adminToken, body: {'clientId': 'c', 'clientSecret': 's'});
      expect(enabled.status, 200);
      expect(enabled.body['configured'], isTrue);

      await launcher.bringUp();
      expect((await call('GET', '/v1/remote-access', token: adminToken)).body['state'], 'online');

      expect((await call('DELETE', '/v1/remote-access', token: adminToken)).body['configured'], isFalse);
    });

    test('a paired phone learns about it from the server status, then asks for its key', () async {
      expect((await call('GET', '/v1/server/status', token: kasirToken)).body['remote'], {'enabled': false, 'online': false, 'address': null});

      await call('PUT', '/v1/remote-access', token: adminToken, body: {'clientId': 'c', 'clientSecret': 's'});
      await launcher.bringUp();

      expect((await call('GET', '/v1/server/status', token: kasirToken)).body['remote'], {'enabled': true, 'online': true, 'address': '100.64.0.7:48950'});

      final grant = await call('POST', '/v1/remote-access/grant', token: kasirToken, body: {'deviceName': 'HP Kasir'});
      expect(grant.status, 200);
      expect(grant.body, {'address': '100.64.0.7:48950', 'authKey': 'tskey-auth-2'});

      expect((await call('POST', '/v1/remote-access/grant', body: {})).status, 401);
    });

    test('wrong passwords lock the account for a while', () async {
      for (var i = 0; i < 3; i++) {
        expect((await call('POST', '/v1/auth/login', body: {'username': 'owner', 'password': 'salah'})).status, 401);
      }

      final locked = await call('POST', '/v1/auth/login', body: {'username': 'OWNER', 'password': 'admin123'});
      expect(locked.status, 429);
      expect(locked.body['error'], contains('Coba lagi dalam 5 menit'));

      // another account is not affected
      expect((await call('POST', '/v1/auth/login', body: {'username': 'kasir1', 'password': 'rahasia'})).status, 200);
    });
  });

  group('limits', () {
    test('an account unlocks once the wait is over, and a success resets the count', () {
      var now = DateTime(2026, 11, 5, 9);
      final limiter = AttemptLimiter(clock: () => now, maxFailures: 2, lockFor: const Duration(minutes: 5));
      Never wrong() => throw UnauthorizedException();

      expect(() => limiter.guard('a', wrong), throwsA(isA<UnauthorizedException>()));
      expect(limiter.guard('a', () => 1), 1);
      expect(() => limiter.guard('a', wrong), throwsA(isA<UnauthorizedException>()));
      expect(() => limiter.guard('a', wrong), throwsA(isA<UnauthorizedException>()));
      expect(() => limiter.guard('a', () => 1), throwsA(isA<TooManyAttemptsException>()));

      now = now.add(const Duration(minutes: 5));
      expect(limiter.guard('a', () => 1), 1);
    });

    test('five wrong pairing codes retire the code', () {
      final codes = PairingCodes();
      final pairing = codes.generate();
      final wrong = pairing.code == '000000' ? '111111' : '000000';

      for (var i = 0; i < 4; i++) {
        expect(() => codes.consume(wrong), throwsA(isA<UnauthorizedException>()));
      }

      expect(() => codes.consume(wrong), throwsA(isA<UnauthorizedException>().having((e) => e.message, 'message', contains('Terlalu banyak'))));
      expect(() => codes.consume(pairing.code), throwsA(isA<UnauthorizedException>()));
    });
  });
}
