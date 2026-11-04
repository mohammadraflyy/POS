import 'dart:async';
import 'dart:io';
import 'dart:isolate';

import 'package:pos_server/pos_server.dart';

/// What happened when the shop PC tried to start its built-in server.
sealed class LocalServerResult {
  const LocalServerResult();
}

class LocalServerReady extends LocalServerResult {
  const LocalServerReady({required this.dbPath, this.imported});

  final String dbPath;

  /// Row counts copied from the old desktop app on this first run; null otherwise.
  final Map<String, int>? imported;
}

class LocalServerFailed extends LocalServerResult {
  const LocalServerFailed(this.message);

  final String message;
}

/// The shop PC is the server: on Windows the app starts it on its own isolate, so a slow
/// query or a stuck printer never freezes the screen. The isolate lives as long as the
/// app does; closing the window stops it.
Future<LocalServerResult> startLocalServer({int port = 48950}) async {
  final replies = ReceivePort();

  try {
    await Isolate.spawn(_serve, (replies.sendPort, port), debugName: 'pos-server', errorsAreFatal: false);

    final first = await replies.first;

    return switch (first) {
      (String dbPath, Map<String, int>? imported) => LocalServerReady(dbPath: dbPath, imported: imported),
      String message => LocalServerFailed(message),
      _ => const LocalServerFailed('Server tidak memberi jawaban.'),
    };
  } on Object catch (error) {
    return LocalServerFailed('Server tidak bisa dijalankan: $error');
  }
}

Future<void> _serve((SendPort, int) args) async {
  final (reply, port) = args;
  final dbPath = defaultShopDbPath();
  Map<String, int>? imported;

  try {
    await startEmbeddedServer(
      dbPath: dbPath,
      legacyDbPath: defaultLegacyDbPath(),
      port: port,
      onImported: (counts) => imported = counts,
      onUnexpected: (error, stack) => _log(dbPath, '$error\n$stack'),
    );
    reply.send((dbPath, imported));
  } on PortInUseException catch (error) {
    reply.send(error.toString());
  } on Object catch (error, stack) {
    _log(dbPath, '$error\n$stack');
    reply.send('Server tidak bisa dijalankan: $error');
  }
}

/// Errors land next to the database, where whoever helps the shop will look.
void _log(String dbPath, String message) {
  try {
    File('${File(dbPath).parent.path}\\server.log').writeAsStringSync('[${DateTime.now().toIso8601String()}] $message\n', mode: FileMode.append);
  } on Object {
    // nowhere left to report to
  }
}
