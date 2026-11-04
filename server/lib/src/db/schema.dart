import 'db.dart';

/// Schema migrations, applied in order and tracked by `PRAGMA user_version`.
///
/// Version 1 is the desktop app's schema as of v0.1.0, table for table and column
/// for column, so `bin/import_legacy.dart` can copy an existing `pos.sqlite` straight
/// in. Add new migrations to the end of the list; never edit one that has shipped.
const List<String> migrations = [
  _v1,
];

void migrate(Db db) {
  final current = db.scalar<int>('PRAGMA user_version') ?? 0;

  for (var version = current; version < migrations.length; version++) {
    db.transaction(() {
      db.raw.execute(migrations[version]);
      db.raw.execute('PRAGMA user_version = ${version + 1}');
    });
  }
}

const _v1 = '''
CREATE TABLE users (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text DEFAULT 'kasir' NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX users_username_unique ON users (username);

CREATE TABLE categories (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nama text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX categories_nama_unique ON categories (nama);

CREATE TABLE units (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  is_active integer DEFAULT 1 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX units_code_unique ON units (code);

CREATE TABLE products (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  kode_item text NOT NULL,
  barcode text,
  nama_item text NOT NULL,
  category_id integer REFERENCES categories(id) ON DELETE SET NULL,
  harga_pokok integer DEFAULT 0 NOT NULL,
  harga_jual integer DEFAULT 0 NOT NULL,
  stok integer DEFAULT 0 NOT NULL,
  is_active integer DEFAULT 1 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX products_kode_item_unique ON products (kode_item);
CREATE UNIQUE INDEX products_barcode_unique ON products (barcode);

CREATE TABLE product_units (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id integer NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  parent_unit_id integer REFERENCES product_units(id) ON DELETE CASCADE,
  jumlah_kemasan integer NOT NULL,
  conversion_factor integer NOT NULL,
  harga_jual integer NOT NULL,
  harga_pokok integer DEFAULT 0 NOT NULL,
  is_base_unit integer DEFAULT 0 NOT NULL,
  is_default_sales_unit integer DEFAULT 0 NOT NULL,
  is_default_purchase_unit integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX product_units_product_id_unit_id_unique ON product_units (product_id, unit_id);

CREATE TABLE product_price_tiers (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_unit_id integer NOT NULL REFERENCES product_units(id) ON DELETE CASCADE,
  min_qty integer NOT NULL,
  max_qty integer,
  harga_jual integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX product_price_tiers_product_unit_id_min_qty_unique ON product_price_tiers (product_unit_id, min_qty);

CREATE TABLE product_price_histories (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  harga_pokok_lama integer NOT NULL,
  harga_pokok_baru integer NOT NULL,
  harga_jual_lama integer NOT NULL,
  harga_jual_baru integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE suppliers (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nama text NOT NULL,
  telepon text,
  alamat text,
  keterangan text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE customers (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nama text NOT NULL,
  telepon text,
  alamat text,
  keterangan text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE purchases (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  supplier_id integer REFERENCES suppliers(id) ON DELETE SET NULL,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  tanggal text NOT NULL,
  total integer DEFAULT 0 NOT NULL,
  dibayar integer DEFAULT 0 NOT NULL,
  catatan text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE purchase_items (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  purchase_id integer NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_unit_id integer REFERENCES product_units(id) ON DELETE SET NULL,
  qty integer NOT NULL,
  konversi integer DEFAULT 1 NOT NULL,
  satuan text,
  harga_beli integer NOT NULL,
  subtotal integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE sales (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  nama_pelanggan text,
  metode_pembayaran text NOT NULL,
  status text DEFAULT 'selesai' NOT NULL,
  diskon integer DEFAULT 0 NOT NULL,
  biaya_lain integer DEFAULT 0 NOT NULL,
  total integer DEFAULT 0 NOT NULL,
  dibayar integer DEFAULT 0 NOT NULL,
  keterangan text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE sale_items (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  sale_id integer NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_unit_id integer REFERENCES product_units(id) ON DELETE SET NULL,
  qty integer NOT NULL,
  konversi integer DEFAULT 1 NOT NULL,
  base_quantity integer DEFAULT 0 NOT NULL,
  satuan text,
  harga_jual integer NOT NULL,
  harga_pokok integer NOT NULL,
  price_source text DEFAULT 'normal' NOT NULL,
  diskon integer DEFAULT 0 NOT NULL,
  subtotal integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE sale_cost_corrections (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  batch_id text NOT NULL,
  sale_id integer NOT NULL,
  sale_item_id integer NOT NULL,
  product_id integer NOT NULL,
  nama_item text NOT NULL,
  satuan text NOT NULL,
  qty integer NOT NULL,
  harga_pokok_lama integer NOT NULL,
  harga_pokok_baru integer NOT NULL,
  user_id integer NOT NULL,
  admin_name text NOT NULL,
  alasan text NOT NULL,
  created_at integer NOT NULL
);

CREATE TABLE sale_edits (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  sale_id integer NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  keterangan text NOT NULL,
  total_sebelum integer NOT NULL,
  total_sesudah integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE purchase_payments (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  purchase_id integer NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  jumlah integer NOT NULL,
  tanggal text NOT NULL,
  keterangan text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE bon_payments (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  sale_id integer NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  jumlah integer NOT NULL,
  tanggal text NOT NULL,
  keterangan text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE cash_expenses (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  tanggal text NOT NULL,
  kategori text NOT NULL,
  jumlah integer NOT NULL,
  keterangan text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE stock_adjustments (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  stok_sebelum integer NOT NULL,
  stok_sesudah integer NOT NULL,
  selisih integer NOT NULL,
  alasan text,
  tanggal text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE stock_movements (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_unit_id integer REFERENCES product_units(id) ON DELETE SET NULL,
  quantity integer NOT NULL,
  conversion_factor integer NOT NULL,
  base_quantity integer NOT NULL,
  movement_type text NOT NULL,
  reference_id integer NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX stock_movements_product_id_id_idx ON stock_movements (product_id, id);

CREATE TABLE device_tokens (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nama_perangkat text,
  token_hash text NOT NULL,
  last_used_at integer,
  revoked_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX device_tokens_token_hash_unique ON device_tokens (token_hash);

CREATE TABLE store_settings (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nama_toko text NOT NULL,
  alamat text,
  telepon text,
  pesan_footer text,
  printer_name text,
  receipt_width text DEFAULT '58mm' NOT NULL,
  margin_minimal_persen integer DEFAULT 10 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
''';
