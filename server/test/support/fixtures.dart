import 'package:pos_server/src/db/db.dart';

const pcsUnitId = 1;
const dusUnitId = 2;

/// The same shop the desktop app's kasir tests run against: one user, two products
/// (Beras 5kg with a qty>=5 tier, Mie Instan with a DUS of 40), PCS base units.
Db seedDb() {
  final db = Db.open(':memory:');
  final now = nowSeconds();

  db.insert("INSERT INTO users (id, username, password_hash, name, role, created_at, updated_at) VALUES (1, 'kasir1', 'hash', 'Kasir Satu', 'kasir', ?, ?)", [now, now]);
  db.insert(
    "INSERT INTO products (id, kode_item, nama_item, harga_jual, harga_pokok, stok, created_at, updated_at) VALUES "
    "(1, 'BRS5', 'Beras 5kg', 6500000, 6000000, 10, ?, ?), (2, 'MIE1', 'Mie Instan', 300000, 250000, 100, ?, ?)",
    [now, now, now, now],
  );
  db.insert(
    "INSERT INTO units (id, code, name, symbol, created_at, updated_at) VALUES (1, 'PCS', 'Pieces', 'pcs', ?, ?), (2, 'DUS', 'Dus', 'dus', ?, ?)",
    [now, now, now, now],
  );
  db.insert(
    'INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, is_base_unit, created_at, updated_at) VALUES '
    '(101, 1, 1, 1, 1, 6500000, 6000000, 1, ?, ?), (102, 2, 1, 1, 1, 300000, 250000, 1, ?, ?), '
    // product 2's base cost is 2.500, so a DUS of 40 costs 100.000
    '(9, 2, 2, 40, 40, 11000000, 10000000, 0, ?, ?)',
    [now, now, now, now, now, now],
  );
  db.insert(
    'INSERT INTO product_price_tiers (id, product_id, product_unit_id, min_qty, max_qty, harga_jual, created_at, updated_at) VALUES (1, 1, 101, 5, NULL, 6200000, ?, ?)',
    [now, now],
  );

  return db;
}

Row saleRow(Db db, int saleId) => db.first('SELECT * FROM sales WHERE id = ?', [saleId])!;

List<Row> saleItemRows(Db db, int saleId) => db.select('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [saleId]);

num stokOf(Db db, int productId) => db.scalar<num>('SELECT stok FROM products WHERE id = ?', [productId])!;
