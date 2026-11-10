import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'mobile_api.dart' show ApiFailure;

/// The phone's way to the shop PC from outside the shop: posnet, the program shipped in
/// the APK, joins the shop's Tailscale network and forwards a local port to the PC. The
/// app then talks plain HTTP to 127.0.0.1 - no Tailscale app, no VPN prompt.
abstract class TailnetClient {
  /// Only Android ships posnet.
  bool get supported;

  /// Starts posnet towards [target] (the PC's tailnet `host:port`), or reuses the one
  /// already running there, and returns the local port to send requests to. [authKey]
  /// is needed until the phone has joined once.
  Future<int> start({required String target, required String hostname, String? authKey});

  /// Fires each time posnet reports the phone is on the tailnet.
  Stream<void> get joined;

  /// Stops posnet; [forget] also deletes the phone's tailnet identity.
  Future<void> stop({bool forget = false});
}

/// What runs on the phone: `libposnet.so` from the folder Android installed it to.
class PosnetClient implements TailnetClient {
  static const _channel = MethodChannel('pos/native');

  Process? _process;
  IOSink? _stdin;
  String? _target;
  int? _port;
  Future<int>? _starting;
  final _joined = StreamController<void>.broadcast();

  @override
  bool get supported => Platform.isAndroid;

  @override
  Stream<void> get joined => _joined.stream;

  Future<({String executable, String state})> _paths() async {
    final paths = await _channel.invokeMapMethod<String, String>('paths');
    if (paths == null) throw const ApiFailure('Komponen internet tidak ditemukan di aplikasi ini.');
    return (executable: '${paths['nativeLibraryDir']}/libposnet.so', state: '${paths['filesDir']}/tailnet');
  }

  @override
  Future<int> start({required String target, required String hostname, String? authKey}) async {
    final running = _port;
    if (_process != null && running != null && _target == target) return running;
    final pending = _starting;
    if (pending != null) return pending;
    if (_process != null) await stop();
    final launch = _launch(target, hostname, authKey);
    _starting = launch;
    try { return await launch; } finally { _starting = null; }
  }

  Future<int> _launch(String target, String hostname, String? authKey) async {
    if (!supported) throw const ApiFailure('Akses lewat internet hanya tersedia di HP Android.');
    final paths = await _paths();
    if (!File(paths.executable).existsSync()) throw const ApiFailure('Komponen internet tidak ada di aplikasi ini. Pasang ulang aplikasi versi terbaru.');
    final process = await Process.start(paths.executable, ['-state', paths.state, '-hostname', hostname, '-dial', target],
      environment: {if (authKey != null) 'POSNET_AUTHKEY': authKey});
    _process = process; _stdin = process.stdin; _target = target;
    final listening = Completer<int>();
    process.stderr.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      debugPrint('[posnet:err] $line');
    });
    process.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      debugPrint('[posnet] $line');
      final Object? event;
      try { event = jsonDecode(line); } on FormatException { return; }
      if (event is! Map) return;
      switch (event['event']) {
        case 'listening':
          final port = event['port'];
          if (port is int && !listening.isCompleted) { _port = port; listening.complete(port); }
        case 'up':
          _joined.add(null);
        case 'error':
          if (!listening.isCompleted) listening.completeError(ApiFailure(event['message']?.toString() ?? 'Penghubung internet gagal.'));
      }
    });
    process.exitCode.then((code) {
      debugPrint('[posnet] exited ($code)');
      if (identical(_process, process)) { _process = null; _stdin = null; _port = null; }
      if (!listening.isCompleted) listening.completeError(const ApiFailure('Penghubung internet berhenti.'));
    });
    try {
      return await listening.future.timeout(const Duration(seconds: 15));
    } on TimeoutException {
      process.kill();
      throw const ApiFailure('Penghubung internet tidak merespons.');
    }
  }

  @override
  Future<void> stop({bool forget = false}) async {
    final process = _process;
    final stdin = _stdin;
    _process = null; _stdin = null; _port = null; _target = null;
    if (process != null) {
      // closing stdin tells posnet to leave cleanly; kill is the backstop
      (stdin ?? process.stdin).close().ignore();
      await process.exitCode.timeout(const Duration(seconds: 3), onTimeout: () { process.kill(); return -1; });
    }
    if (forget && supported) {
      final dir = Directory((await _paths()).state);
      if (dir.existsSync()) dir.deleteSync(recursive: true);
    }
  }
}
