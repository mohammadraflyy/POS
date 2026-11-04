/// The shop PC runs the server inside the Flutter app rather than as its own program.
/// This is the one call that app makes: claim the port, bring the desktop app's data over
/// on first run, then serve.
library;

import 'dart:io';

import 'db/legacy_import.dart';
import 'printing/printer.dart';
import '../pos_server.dart';

/// Another program (usually the old POS desktop) already listens on the port.
class PortInUseException implements Exception {
  const PortInUseException(this.port);

  final int port;

  @override
  String toString() => 'Port $port sedang dipakai aplikasi lain. Tutup POS Desktop yang lama, lalu buka aplikasi ini lagi.';
}

/// Where the shop's data lives on Windows: `%APPDATA%\point_of_sales\pos.sqlite`.
/// A different folder from the desktop app's `%APPDATA%\point-of-sale`, so the two can
/// never open the same file.
String defaultShopDbPath() => '${Platform.environment['APPDATA'] ?? Directory.current.path}\\point_of_sales\\pos.sqlite';

/// The desktop app's database, read once on first run.
String defaultLegacyDbPath() => '${Platform.environment['APPDATA'] ?? Directory.current.path}\\point-of-sale\\pos.sqlite';

/// Copies [legacyDbPath] into a brand-new [dbPath], through a temporary file so a crash
/// halfway never leaves a half-imported database that would look like a real one next
/// time. Returns the row counts, or null when there was nothing to import.
Map<String, int>? importLegacyOnFirstRun({required String dbPath, required String? legacyDbPath}) {
  if (File(dbPath).existsSync() || legacyDbPath == null || !File(legacyDbPath).existsSync()) {
    return null;
  }

  final staging = '$dbPath.importing';

  for (final suffix in ['', '-wal', '-shm']) {
    final leftover = File('$staging$suffix');

    if (leftover.existsSync()) {
      leftover.deleteSync();
    }
  }

  final db = Db.open(staging);
  final Map<String, int> counts;

  try {
    counts = importLegacyDatabase(db, legacyDbPath);
    db.raw.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }

  File(staging).renameSync(dbPath);

  for (final suffix in ['-wal', '-shm']) {
    final leftover = File('$staging$suffix');

    if (leftover.existsSync()) {
      leftover.deleteSync();
    }
  }

  return counts;
}

/// Whether something already serves [port]. Windows lets a second socket bind a port
/// another program listens on, so a trial bind proves nothing there - knock instead: if
/// anything answers on loopback, the port is taken.
Future<bool> isPortTaken(int port) async {
  try {
    final socket = await Socket.connect(InternetAddress.loopbackIPv4, port, timeout: const Duration(seconds: 2));
    socket.destroy();

    return true;
  } on SocketException {
    // nobody answered - but the port may still be held without accepting, so try to own it
  }

  try {
    final probe = await ServerSocket.bind(InternetAddress.anyIPv4, port);
    await probe.close();

    return false;
  } on SocketException {
    return true;
  }
}

/// Starts the server for the shop PC. Throws [PortInUseException] before touching any
/// file when the port is taken - the old desktop app still running must not race an
/// import of its own database.
Future<RunningServer> startEmbeddedServer({
  String? dbPath,
  String? legacyDbPath,
  int port = 48950,
  RawPrinter? printer,
  void Function(Object, StackTrace)? onUnexpected,
  void Function(Map<String, int> counts)? onImported,
}) async {
  final path = dbPath ?? defaultShopDbPath();

  if (await isPortTaken(port)) {
    throw PortInUseException(port);
  }

  Directory(File(path).parent.path).createSync(recursive: true);

  final counts = importLegacyOnFirstRun(dbPath: path, legacyDbPath: legacyDbPath);

  if (counts != null) {
    onImported?.call(counts);
  }

  return startServer(dbPath: path, port: port, printer: printer, onUnexpected: onUnexpected);
}
