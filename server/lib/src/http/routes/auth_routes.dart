import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../../core/errors.dart';
import '../../domain/auth.dart';
import '../../domain/device_tokens.dart';
import '../../domain/users.dart';
import '../../remote/remote_access.dart';
import '../api.dart';

String _loginKey(String username) => 'login:${username.trim().toLowerCase()}';

RemoteAccess _remote(ApiContext ctx) => ctx.remote ?? (throw BusinessException('Server ini tidak menyediakan akses dari luar toko.'));

/// Health, pairing, sign-in, users, and paired devices.
void addAuthRoutes(Router router, ApiContext ctx) {
  final db = ctx.db;

  router.get('/v1/health', (Request request) => json(withVersion({'ok': true})));

  // A phone scans the PC's QR (address + one-time code) and signs in with its own account.
  router.post('/v1/pair', (Request request) async {
    final body = await readJson(request);
    final code = body.stringOr('pairingCode');
    final username = body.stringOr('username');
    final password = body.stringOr('password');

    if (code == null || code.isEmpty || username == null || username.isEmpty || password == null || password.isEmpty) {
      throw BadRequest('pairingCode, username, dan password wajib diisi.');
    }

    // a wrong code and a wrong password both answer 401 - the phone handles them alike
    ctx.pairing.consume(code);
    final user = ctx.logins.guard(_loginKey(username), () => verifyLogin(db, username, password));
    final issued = issueDeviceToken(db, userId: user.id, namaPerangkat: body.stringOr('deviceName'));

    return json(withVersion({'token': issued.token, 'user': user.toJson()}));
  });

  // Sign-in without a pairing code, for a client on the shop PC itself or an admin's own
  // device. The token is a device token like any other, revocable from the device list.
  router.post('/v1/auth/login', (Request request) async {
    final body = await readJson(request);
    final username = body.string('username');
    final user = ctx.logins.guard(_loginKey(username), () => verifyLogin(db, username, body.string('password')));
    final issued = issueDeviceToken(db, userId: user.id, namaPerangkat: body.stringOr('deviceName'));

    return json(withVersion({'token': issued.token, 'user': user.toJson()}));
  });

  router.post('/v1/auth/logout', (Request request) {
    requireUser(ctx, request);
    revokeToken(db, bearerToken(request)!);

    return ok();
  });

  router.get('/v1/me', (Request request) => json(withVersion({'user': requireUser(ctx, request).toJson()})));

  // --- users (admin) ---

  router.get('/v1/users', (Request request) {
    requireAdmin(ctx, request);

    return json({'data': listUsers(db)});
  });

  router.post('/v1/users', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);
    final id = createUser(db, username: body.string('username'), name: body.string('name'), password: body.string('password'), role: UserRole.parse(body['role']));

    return json({'id': id});
  });

  router.put('/v1/users/<id>', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);

    updateUser(db, pathInt(request, 'id'), name: body.string('name'), role: UserRole.parse(body['role']), password: body.stringOr('password'));

    return ok();
  });

  router.delete('/v1/users/<id>', (Request request) {
    final admin = requireAdmin(ctx, request);

    deleteUser(db, pathInt(request, 'id'), admin.id);

    return ok();
  });

  // --- paired devices ---

  router.get('/v1/server/status', (Request request) {
    requireUser(ctx, request);

    final remote = ctx.remote;

    return json({
      'running': true,
      'address': ctx.serverAddress(),
      'port': ctx.port,
      // what a phone needs to decide whether to ask for access from outside the shop
      'remote': {
        'enabled': remote != null && remote.isConfigured,
        'online': remote?.state == RemoteState.online,
        'address': remote?.status()['address'],
      },
    });
  });

  // --- access from outside the shop (Tailscale) ---

  router.get('/v1/remote-access', (Request request) {
    requireAdmin(ctx, request);

    return json(ctx.remote?.status() ?? {'available': false, 'configured': false, 'state': 'off', 'address': null, 'message': null});
  });

  router.put('/v1/remote-access', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);
    final remote = _remote(ctx);

    await remote.enable(clientId: body.string('clientId'), clientSecret: body.string('clientSecret'));

    return json(remote.status());
  });

  router.delete('/v1/remote-access', (Request request) async {
    requireAdmin(ctx, request);
    final remote = _remote(ctx);

    await remote.disable();

    return json(remote.status());
  });

  // A paired phone, on the shop's Wi-Fi, asks for its own way in from outside.
  router.post('/v1/remote-access/grant', (Request request) async {
    final user = requireUser(ctx, request);
    final body = await readJson(request);

    return json(await _remote(ctx).grant(deviceName: body.stringOr('deviceName') ?? user.name));
  });

  // The QR payload is `{"address": "<ip>:<port>", "code": "<6 digits>"}`.
  router.post('/v1/devices/pairing-code', (Request request) {
    requireAdmin(ctx, request);
    final pairing = ctx.pairing.generate();
    final address = ctx.serverAddress();

    return json({
      'code': pairing.code,
      'expiresAt': pairing.expiresAt.toIso8601String(),
      'serverAddress': address == null ? null : '$address:${ctx.port}',
    });
  });

  router.get('/v1/devices', (Request request) {
    requireAdmin(ctx, request);

    return json({'data': listPairedDevices(db)});
  });

  router.delete('/v1/devices/<id>', (Request request) {
    requireAdmin(ctx, request);
    revokeDevice(db, pathInt(request, 'id'));

    return ok();
  });
}
