import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/db/db.dart';
import 'package:pos_server/src/db/demo_seed.dart';
import 'package:pos_server/src/domain/auth.dart';
import 'package:test/test.dart';

void main() {
  late Db db;

  setUp(() => db = Db.open(':memory:'));
  tearDown(() => db.close());

  test('fills an empty shop with consistent demo data', () {
    final counts = seedDemoData(db, today: DateTime(2026, 11, 4));

    expect(counts['products'], 32);
    expect(counts['sales'], greaterThan(200));
    expect(db.scalar<int>('SELECT count(*) FROM product_units WHERE is_base_unit = 1'), 32);
    expect(db.scalar<int>('SELECT count(*) FROM product_price_tiers'), greaterThan(0));
    expect(db.scalar<int>('SELECT count(*) FROM products WHERE stok < 0'), 0);

    // every sale total matches its lines, and bons are the only sales with money still owed
    final mismatched = db.scalar<int>(
      'SELECT count(*) FROM sales s WHERE s.total != (SELECT sum(subtotal) FROM sale_items WHERE sale_id = s.id) + s.biaya_lain - s.diskon',
    );
    expect(mismatched, 0);
    expect(db.scalar<int>("SELECT count(*) FROM sales WHERE dibayar < total AND metode_pembayaran != 'bon'"), 0);
    expect(db.scalar<int>("SELECT count(*) FROM sales WHERE metode_pembayaran = 'bon' AND dibayar < total"), greaterThan(0));

    // some supplier debt is left open
    expect(db.scalar<int>('SELECT count(*) FROM purchases WHERE dibayar < total'), greaterThan(0));

    // stock on hand equals every movement added up
    final drift = db.scalar<int>(
      'SELECT count(*) FROM products p WHERE abs(p.stok - coalesce((SELECT sum(base_quantity) FROM stock_movements WHERE product_id = p.id), 0)) > 0.001',
    );
    expect(drift, 0);

    expect(verifyLogin(db, 'kasir1', 'kasir1').name, 'Rina (Kasir)');
  });

  test('is repeatable for the same seed', () {
    seedDemoData(db, today: DateTime(2026, 11, 4));
    final other = Db.open(':memory:');
    addTearDown(other.close);
    seedDemoData(other, today: DateTime(2026, 11, 4));

    const sql = 'SELECT count(*), sum(total) FROM sales';
    expect(other.first(sql), db.first(sql));
  });

  test('refuses a database that already has products', () {
    seedDemoData(db);

    expect(() => seedDemoData(db), throwsA(isA<BusinessException>()));
  });
}
