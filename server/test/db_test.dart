import 'package:pos_server/src/db/db.dart';
import 'package:pos_server/src/db/demo_seed.dart';
import 'package:pos_server/src/db/schema.dart';
import 'package:pos_server/src/domain/kasir.dart';
import 'package:test/test.dart';

void main() {
  test('creates every table and records the schema version', () {
    final db = Db.open(':memory:');
    final tables = db.select("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name");

    expect(tables.map((t) => t['name']), containsAll(['sales', 'remote_access']));
    expect(tables, hasLength(23));
    expect(db.scalar<int>('PRAGMA user_version'), 2);
    expect(db.scalar<int>('PRAGMA foreign_keys'), 1);
  });

  test('rolls back a failed nested transaction without losing the outer work', () {
    final db = Db.open(':memory:');

    db.transaction(() {
      db.insert("insert into categories (nama, created_at, updated_at) values ('A', 0, 0)");

      expect(
        () => db.transaction(() {
          db.insert("insert into categories (nama, created_at, updated_at) values ('B', 0, 0)");
          throw StateError('boom');
        }),
        throwsStateError,
      );
    });

    expect(db.select('select nama from categories').map((r) => r['nama']), ['A']);
    expect(db.execute("update categories set nama = 'C'"), 1);
  });

  test('previewCart includes line hargaPokok and total modal for profit estimation', () {
    final db = Db.open(':memory:');
    seedDemoData(db);
    final firstProduct = db.first('SELECT id, harga_pokok FROM products WHERE is_active = 1 LIMIT 1')!;
    final res = previewCart(db, [CartItemInput(productId: firstProduct['id'] as int, qty: 2)]);
    final lines = res['lines'] as List;
    expect(lines, hasLength(1));
    expect((lines.first as Map)['hargaPokok'], isNotNull);
    expect(res['modal'], ((firstProduct['harga_pokok'] as int) * 2) / 100);
    db.close();
  });

  test('upgrades an existing desktop-node Drizzle database (user_version = 0) in-place without recreating tables', () {
    final db = Db.open(':memory:');
    db.raw.execute('DROP TABLE sale_cost_corrections');
    db.raw.execute('DROP TABLE remote_access');
    db.raw.execute('PRAGMA user_version = 0');
    db.insert("INSERT INTO categories (nama, created_at, updated_at) VALUES ('Existing', 0, 0)");

    // Re-running migrate on a user_version = 0 DB that already has products/categories preserves rows and adds missing tables.
    migrate(db);

    expect(db.scalar<int>('PRAGMA user_version'), 2);
    expect(db.select('SELECT nama FROM categories').map((r) => r['nama']), ['Existing']);
    final tables = db.select("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t['name']).toList();
    expect(tables, containsAll(['sale_cost_corrections', 'remote_access']));
    db.close();
  });
}
