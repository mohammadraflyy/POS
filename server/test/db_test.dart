import 'package:pos_server/src/db/db.dart';
import 'package:test/test.dart';

void main() {
  test('creates every table and records the schema version', () {
    final db = Db.open(':memory:');
    final tables = db.select("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name");

    expect(tables.map((t) => t['name']), contains('sales'));
    expect(tables, hasLength(22));
    expect(db.scalar<int>('PRAGMA user_version'), 1);
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
}
