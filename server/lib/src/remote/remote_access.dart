import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../core/errors.dart';
import '../db/db.dart';
import 'tailscale_api.dart';

/// A running `posnet` - the program that joins the tailnet - seen from the server.
abstract class TailnetProcess {
  /// One JSON object per line of the program's stdout: `{"event": "up", "ip": ...}` etc.
  Stream<Map<String, Object?>> get events;

  Future<int> get exitCode;

  void kill();
}

/// Starts `posnet` with [args]; [authKey] goes in through the environment.
typedef TailnetLauncher = Future<TailnetProcess> Function(List<String> args, {String? authKey});

/// Launches the real `posnet` executable at [executable].
TailnetLauncher processTailnetLauncher(String executable) => (args, {authKey}) async {
      final process = await Process.start(executable, args, environment: {'POSNET_AUTHKEY': ?authKey});

      return _ProcessTailnet(process);
    };

class _ProcessTailnet implements TailnetProcess {
  _ProcessTailnet(this._process) {
    _process.stderr.drain<void>();
  }

  final Process _process;

  @override
  late final Stream<Map<String, Object?>> events = _process.stdout
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .map((line) {
        try {
          final decoded = jsonDecode(line);

          return decoded is Map<String, Object?> ? decoded : null;
        } on FormatException {
          return null;
        }
      })
      .where((event) => event != null)
      .cast<Map<String, Object?>>()
      .asBroadcastStream();

  @override
  Future<int> get exitCode => _process.exitCode;

  // closing stdin is posnet's cue to leave the tailnet cleanly; kill is the backstop
  @override
  void kill() {
    _process.stdin.close().ignore();
    Future<void>.delayed(const Duration(seconds: 3), () => _process.kill());
  }
}

enum RemoteState { off, starting, online, failed }

/// Access to the shop PC from outside the shop, over the shop's own Tailscale network.
///
/// The owner pastes the shop's OAuth client once. From then on the PC joins the tailnet
/// by itself every time the app starts, and each phone that pairs at the shop gets its
/// own single-use key, so it can keep reaching the PC from anywhere.
class RemoteAccess {
  RemoteAccess({
    required this.db,
    required this.stateDir,
    required this.port,
    this.launcher,
    TailscaleApi? api,
    this.hostname = 'pos-pc',
    this.restartDelay = const Duration(seconds: 10),
  }) : api = api ?? TailscaleApi();

  final Db db;
  final TailscaleApi api;

  /// Null when this build ships without `posnet`; remote access is then unavailable.
  final TailnetLauncher? launcher;

  /// Where the PC's tailnet identity lives. Deleting it makes the PC a new device.
  final String stateDir;
  final int port;
  final String hostname;
  final Duration restartDelay;

  RemoteState _state = RemoteState.off;
  String? _ip;
  String? _message;
  TailnetProcess? _process;
  Timer? _restart;
  int _run = 0;

  RemoteState get state => _state;

  /// The PC's address on the tailnet, once online.
  String? get ip => _ip;

  bool get isConfigured => _credentials() != null;

  Map<String, Object?> status() => {
        'available': launcher != null,
        'configured': isConfigured,
        'state': _state.name,
        'address': _ip == null ? null : '$_ip:$port',
        'message': _message,
      };

  /// Brings the PC back onto the tailnet at startup, when the owner set it up before.
  Future<void> resume() async {
    if (launcher == null || !isConfigured) {
      return;
    }

    final run = _run;

    try {
      await _start();
    } on Object catch (error) {
      if (run == _run) {
        _fail(error.toString());
        _scheduleRestart(run);
      }
    }
  }

  /// Saves the shop's OAuth client and joins the tailnet with it. The client is checked
  /// by minting the PC's own key first, so a wrong paste is refused right away.
  Future<void> enable({required String clientId, required String clientSecret}) async {
    if (launcher == null) {
      throw BusinessException('Versi aplikasi ini belum menyertakan akses dari luar toko.');
    }

    final id = clientId.trim();
    final secret = clientSecret.trim();

    if (id.isEmpty || secret.isEmpty) {
      throw BusinessException('Client ID dan Client Secret wajib diisi.');
    }

    final key = await api.mintAuthKey(clientId: id, clientSecret: secret, description: 'POS PC toko');

    await _stop();
    _forgetIdentity();

    final now = nowSeconds();

    db.execute(
      'INSERT INTO remote_access (id, oauth_client_id, oauth_client_secret, created_at, updated_at) VALUES (1, ?, ?, ?, ?) '
      'ON CONFLICT (id) DO UPDATE SET oauth_client_id = excluded.oauth_client_id, oauth_client_secret = excluded.oauth_client_secret, updated_at = excluded.updated_at',
      [id, secret, now, now],
    );

    await _launch(key);
  }

  /// Leaves the tailnet and forgets the OAuth client. Phones lose access from outside the
  /// shop; on the shop's Wi-Fi they keep working.
  Future<void> disable() async {
    await _stop();
    db.execute('DELETE FROM remote_access');
    _forgetIdentity();
    _state = RemoteState.off;
    _ip = null;
    _message = null;
  }

  /// What a phone needs to reach the PC from outside: the PC's tailnet address and a
  /// key of its own to join with.
  Future<Map<String, Object?>> grant({required String deviceName}) async {
    final credentials = _credentials();

    if (credentials == null) {
      throw BusinessException('Akses dari luar toko belum diaktifkan di PC.');
    }

    if (_state != RemoteState.online || _ip == null) {
      throw BusinessException('PC toko belum tersambung ke Tailscale. Tunggu sebentar lalu coba lagi.');
    }

    final key = await api.mintAuthKey(clientId: credentials.id, clientSecret: credentials.secret, description: 'POS HP $deviceName');

    return {'address': '$_ip:$port', 'authKey': key};
  }

  Future<void> close() => _stop();

  ({String id, String secret})? _credentials() {
    final row = db.first('SELECT oauth_client_id, oauth_client_secret FROM remote_access WHERE id = 1');

    return row == null ? null : (id: row['oauth_client_id'] as String, secret: row['oauth_client_secret'] as String);
  }

  bool get _hasIdentity => File('$stateDir${Platform.pathSeparator}tailscaled.state').existsSync();

  /// A PC that already joined keeps its identity; only a new one needs a key.
  Future<void> _start() async {
    final credentials = _credentials();

    if (credentials == null) {
      return;
    }

    final key = _hasIdentity ? null : await api.mintAuthKey(clientId: credentials.id, clientSecret: credentials.secret, description: 'POS PC toko');

    await _launch(key);
  }

  Future<void> _launch(String? authKey) async {
    final run = ++_run;

    Directory(stateDir).createSync(recursive: true);
    _state = RemoteState.starting;
    _message = null;

    final process = await launcher!(['-state', stateDir, '-hostname', hostname, '-tag', posTag, '-serve', '$port'], authKey: authKey);

    if (run != _run) {
      process.kill();

      return;
    }

    _process = process;

    process.events.listen((event) {
      if (run != _run) {
        return;
      }

      switch (event['event']) {
        case 'up':
          _ip = event['ip'] as String?;
        case 'serving':
          _state = RemoteState.online;
          _message = null;
        case 'waiting':
          _state = RemoteState.starting;
          _message = 'Menunggu internet atau Tailscale...';
        case 'error':
          _message = event['message'] as String?;
      }
    }, onError: (Object _) {});

    process.exitCode.then((code) {
      if (run != _run) {
        return;
      }

      _process = null;
      _fail(_message ?? 'Penghubung Tailscale berhenti (kode $code).');
      _scheduleRestart(run);
    });
  }

  /// No internet at boot, or posnet crashed: try again in a moment, for as long as the
  /// owner keeps remote access switched on.
  void _scheduleRestart(int run) {
    _restart?.cancel();
    _restart = Timer(restartDelay, () {
      if (run == _run && isConfigured) {
        resume();
      }
    });
  }

  void _fail(String message) {
    _state = RemoteState.failed;
    _message = message;
  }

  /// Waits for posnet to exit, so its files are no longer held open.
  Future<void> _stop() async {
    _run++;
    _restart?.cancel();
    _restart = null;

    final process = _process;
    _process = null;

    if (process != null) {
      process.kill();
      await process.exitCode.timeout(const Duration(seconds: 5), onTimeout: () => -1);
    }
  }

  void _forgetIdentity() {
    final dir = Directory(stateDir);

    if (dir.existsSync()) {
      try {
        dir.deleteSync(recursive: true);
      } on FileSystemException {
        // a posnet that would not die still holds it, and a new key is ignored while an
        // old identity exists - so stop here rather than join with the wrong one
        throw BusinessException('Data Tailscale lama masih dipakai. Tutup aplikasi, buka lagi, lalu ulangi.');
      }
    }
  }
}
