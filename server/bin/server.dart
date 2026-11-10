import 'dart:io';

import 'package:pos_server/pos_server.dart';

const _usage = '''
POS server - database toko + HTTP API untuk aplikasi Flutter.

  dart run bin/server.dart [--db <file>] [--port <port>] [--posnet <file>]

  --db       file database SQLite (default: pos.sqlite di folder ini)
  --port     port HTTP (default: 48950)
  --posnet   program posnet, untuk akses dari luar toko lewat Tailscale
             (build: tailnet/build.ps1)

Akun awal di database baru: admin / admin. Segera ganti password-nya.
''';

Future<void> main(List<String> args) async {
  if (args.contains('--help') || args.contains('-h')) {
    stdout.write(_usage);
    return;
  }

  String option(String name, String fallback) {
    final index = args.indexOf(name);

    return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
  }

  final dbPath = option('--db', 'pos.sqlite');
  final posnet = option('--posnet', '');
  final port = int.tryParse(option('--port', '48950'));

  if (port == null) {
    stderr.writeln('Port tidak valid.');
    exitCode = 64;
    return;
  }

  final RunningServer running;

  try {
    running = await startServer(
      dbPath: dbPath,
      port: port,
      onUnexpected: (error, stack) => stderr.writeln('[error] $error\n$stack'),
      tailnet: posnet.isEmpty ? null : processTailnetLauncher(posnet),
    );
  } on SocketException catch (error) {
    stderr.writeln('Gagal membuka port $port: ${error.message}. Apakah aplikasi lain (mis. POS desktop) sedang memakai port ini?');
    exitCode = 1;
    return;
  }

  final address = running.ctx.serverAddress();
  // one code at start-up, so the first phone can pair before any admin has signed in
  final pairing = running.ctx.pairing.generate();

  stdout
    ..writeln('POS server v$appVersion')
    ..writeln('Database : ${File(dbPath).absolute.path}')
    ..writeln('Alamat   : ${address ?? 'tidak terhubung ke jaringan'}:$port')
    ..writeln('Pairing  : kode ${pairing.code} (berlaku 5 menit)')
    ..writeln('           QR: {"address":"${address ?? '127.0.0.1'}:$port","code":"${pairing.code}"}')
    ..writeln('Tekan Ctrl+C untuk berhenti.');

  ProcessSignal.sigint.watch().first.then((_) async {
    stdout.writeln('Menghentikan server...');
    await running.close();
    exit(0);
  });
}
