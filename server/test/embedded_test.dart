import 'dart:io';

import 'package:pos_server/pos_server.dart';
import 'package:pos_server/src/domain/kasir.dart';
import 'package:pos_server/src/printing/printer.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

void main() {
  late Directory dir;

  setUp(() => dir = Directory.systemTemp.createTempSync('pos-embedded-'));
  tearDown(() => dir.deleteSync(recursive: true));

  /// The old desktop app's database with one sale in it.
  String legacyFile() {
    final path = '${dir.path}/legacy.sqlite';
    final source = seedDb();

    checkout(source, const CheckoutInput(metodePembayaran: MetodePembayaran.tunai, namaPelanggan: null, dibayar: 1000000, userId: 1, items: [CartItemInput(productId: 2, qty: 1)]));
    source.raw.execute("VACUUM INTO '${path.replaceAll("'", "''")}'");
    source.close();

    return path;
  }

  int count(String dbPath, String table) {
    final db = Db.open(dbPath);

    try {
      return db.scalar<int>('SELECT count(*) FROM $table')!;
    } finally {
      db.close();
    }
  }

  test('imports the desktop database on first run only', () {
    final dbPath = '${dir.path}/new/pos.sqlite';
    final legacy = legacyFile();

    Directory('${dir.path}/new').createSync();

    final counts = importLegacyOnFirstRun(dbPath: dbPath, legacyDbPath: legacy);

    expect(counts!['sales'], 1);
    expect(count(dbPath, 'products'), 2);
    expect(File('$dbPath.importing').existsSync(), isFalse);

    // a second start finds its own database and leaves it alone
    expect(importLegacyOnFirstRun(dbPath: dbPath, legacyDbPath: legacy), isNull);
  });

  test('starts empty when there is no desktop database', () {
    final dbPath = '${dir.path}/pos.sqlite';

    expect(importLegacyOnFirstRun(dbPath: dbPath, legacyDbPath: '${dir.path}/missing.sqlite'), isNull);
    expect(File(dbPath).existsSync(), isFalse);
  });

  test('serves the imported data and refuses a port that is taken, before touching files', () async {
    final dbPath = '${dir.path}/data/pos.sqlite';
    final running = await startEmbeddedServer(dbPath: dbPath, legacyDbPath: legacyFile(), port: 48961, printer: const NoPrinter());

    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('http://127.0.0.1:48961/v1/health'));
      final response = await request.close();

      expect(response.statusCode, 200);
      client.close();

      final otherDb = '${dir.path}/other/pos.sqlite';

      await expectLater(startEmbeddedServer(dbPath: otherDb, port: 48961), throwsA(isA<PortInUseException>()));
      expect(Directory('${dir.path}/other').existsSync(), isFalse);
    } finally {
      await running.close();
    }

    expect(count(dbPath, 'sales'), 1);
  });
}
