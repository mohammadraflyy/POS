/// Backend POS toko: SQLite database + HTTP API for the Flutter apps.
library;

import 'dart:io';

import 'package:shelf/shelf_io.dart' as shelf_io;

import 'src/db/db.dart';
import 'src/domain/auth.dart';
import 'src/domain/pairing.dart';
import 'src/http/api.dart';
import 'src/http/app.dart';
import 'src/printing/printer.dart';
import 'src/printing/receipts.dart';
import 'src/remote/remote_access.dart';

export 'src/db/db.dart' show Db;
export 'src/embedded.dart' show PortInUseException, defaultLegacyDbPath, defaultShopDbPath, importLegacyOnFirstRun, startEmbeddedServer;
export 'src/domain/pairing.dart' show PairingCodes;
export 'src/http/api.dart' show ApiContext;
export 'src/http/app.dart' show buildHandler;
export 'src/remote/remote_access.dart' show RemoteAccess, RemoteState, TailnetLauncher, TailnetProcess, processTailnetLauncher;
export 'src/version.dart' show appVersion;

class RunningServer {
  RunningServer(this.server, this.ctx);

  final HttpServer server;
  final ApiContext ctx;

  Future<void> close() async {
    await server.close(force: true);
    await ctx.remote?.close();
    ctx.db.close();
  }
}

/// The first non-internal IPv4 address - what a phone on the same Wi-Fi should dial.
/// Null when the PC is on no network.
Future<String?> lanAddress() async {
  try {
    final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4, includeLoopback: false);

    for (final interface in interfaces) {
      for (final address in interface.addresses) {
        if (!address.isLoopback && !address.isLinkLocal) {
          return address.address;
        }
      }
    }
  } on Object {
    // no network: callers show "not connected" rather than an error
  }

  return null;
}

/// Opens the database, makes sure an admin exists, and listens on every interface.
///
/// With [tailnet] the server can also be reached from outside the shop: it rejoins the
/// shop's Tailscale network by itself when the owner switched that on before. Its
/// identity lives in [tailnetStateDir], by default a `tailnet` folder beside the database.
Future<RunningServer> startServer({
  required String dbPath,
  int port = 48950,
  RawPrinter? printer,
  void Function(Object, StackTrace)? onUnexpected,
  TailnetLauncher? tailnet,
  String? tailnetStateDir,
}) async {
  final db = Db.open(dbPath);

  seedDefaultAdmin(db);

  var address = await lanAddress();
  final remote = RemoteAccess(
    db: db,
    launcher: tailnet,
    stateDir: tailnetStateDir ?? '${File(dbPath).absolute.parent.path}${Platform.pathSeparator}tailnet',
    port: port,
  );
  final ctx = ApiContext(
    db: db,
    pairing: PairingCodes(),
    receipts: ReceiptService(db, printer ?? defaultRawPrinter()),
    serverAddress: () => address,
    port: port,
    remote: remote,
  );

  // the router hands out a fresh address after a DHCP renewal, so look again now and then
  Stream<void>.periodic(const Duration(minutes: 1)).listen((_) async => address = await lanAddress() ?? address);

  final server = await shelf_io.serve(buildHandler(ctx, onUnexpected: onUnexpected), InternetAddress.anyIPv4, port);

  // in the background: the shop's Wi-Fi must not wait on the internet
  remote.resume().ignore();

  return RunningServer(server, ctx);
}
