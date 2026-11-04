import 'dart:io';

import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/db/db.dart';
import 'package:pos_server/src/db/legacy_import.dart';
import 'package:pos_server/src/domain/auth.dart';
import 'package:pos_server/src/domain/kasir.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

void main() {
  late Directory dir;

  setUp(() => dir = Directory.systemTemp.createTempSync('pos-import-'));
  tearDown(() => dir.deleteSync(recursive: true));

  /// A desktop-era database: an older schema without `biaya_lain`, with a real sale in it.
  String legacyFile() {
    final path = '${dir.path}/legacy.sqlite';
    final source = seedDb();

    checkout(source, const CheckoutInput(metodePembayaran: MetodePembayaran.bon, namaPelanggan: 'Bu Siti', dibayar: 100000, userId: 1, items: [CartItemInput(productId: 2, qty: 3)]));
    source.execute("UPDATE users SET password_hash = ? WHERE id = 1", [hashPassword('rahasia')]);
    source.raw.execute("VACUUM INTO '${path.replaceAll("'", "''")}'");
    source.close();

    final legacy = Db.open(path);
    legacy.raw.execute('ALTER TABLE sales DROP COLUMN biaya_lain');
    legacy.close();

    return path;
  }

  test('copies every row, keeps ids, and lets the old accounts sign in', () {
    final target = Db.open(':memory:');
    seedDefaultAdmin(target);

    final counts = importLegacyDatabase(target, legacyFile());

    expect(counts['products'], 2);
    expect(counts['sales'], 1);
    expect(counts['stock_movements'], 1);
    expect(target.scalar<num>('SELECT stok FROM products WHERE id = 2'), 97);
    expect(target.first('SELECT * FROM sales WHERE id = 1')!['biaya_lain'], 0);
    expect(verifyLogin(target, 'kasir1', 'rahasia').name, 'Kasir Satu');
    expect(() => verifyLogin(target, 'admin', 'admin'), throwsA(isA<UnauthorizedException>()));

    // and it keeps working as a shop afterwards
    final next = checkout(target, const CheckoutInput(metodePembayaran: MetodePembayaran.tunai, namaPelanggan: null, dibayar: 300000, userId: 1, items: [CartItemInput(productId: 2, qty: 1)]));
    expect(next.saleId, 2);
  });

  test('refuses a target that already holds shop data, and leaves it untouched', () {
    final target = seedDb();

    expect(() => importLegacyDatabase(target, legacyFile()), throwsA(isA<BusinessException>()));
    expect(target.scalar<int>('SELECT count(*) FROM users'), 1);
  });

  test('refuses a file that is not a POS database', () {
    sqlite3.open('${dir.path}/other.sqlite')
      ..execute('CREATE TABLE notes (id integer)')
      ..close();

    expect(() => importLegacyDatabase(Db.open(':memory:'), '${dir.path}/other.sqlite'), throwsA(isA<BusinessException>()));
  });
}
