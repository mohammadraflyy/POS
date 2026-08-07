import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

function timestamps() {
  return {
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  }
}

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  ...timestamps(),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nama: text('nama').notNull().unique(),
  ...timestamps(),
})

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kodeItem: text('kode_item').notNull().unique(),
  barcode: text('barcode').unique(),
  namaItem: text('nama_item').notNull(),
  categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
  satuan: text('satuan').notNull(),
  hargaPokok: integer('harga_pokok').notNull().default(0),
  hargaJual: integer('harga_jual').notNull().default(0),
  stok: integer('stok').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps(),
})

export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  level: integer('level').notNull().default(2),
  satuan: text('satuan').notNull(),
  jumlahKemasan: integer('jumlah_kemasan').notNull().default(0),
  konversi: integer('konversi').notNull(),
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productLevelUnique: uniqueIndex('product_units_product_id_level_unique').on(table.productId, table.level),
}))

export const productPriceTiers = sqliteTable('product_price_tiers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  minQty: integer('min_qty').notNull(),
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productMinQtyUnique: uniqueIndex('product_price_tiers_product_id_min_qty_unique').on(table.productId, table.minQty),
}))

export const productPriceHistories = sqliteTable('product_price_histories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  hargaPokokLama: integer('harga_pokok_lama').notNull(),
  hargaPokokBaru: integer('harga_pokok_baru').notNull(),
  hargaJualLama: integer('harga_jual_lama').notNull(),
  hargaJualBaru: integer('harga_jual_baru').notNull(),
  ...timestamps(),
})

export const suppliers = sqliteTable('suppliers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nama: text('nama').notNull(),
  telepon: text('telepon'),
  alamat: text('alamat'),
  keterangan: text('keterangan'),
  ...timestamps(),
})

export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  supplierId: integer('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  tanggal: text('tanggal').notNull(),
  total: integer('total').notNull().default(0),
  catatan: text('catatan'),
  ...timestamps(),
})

export const purchaseItems = sqliteTable('purchase_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  purchaseId: integer('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull(),
  hargaBeli: integer('harga_beli').notNull(),
  subtotal: integer('subtotal').notNull(),
  ...timestamps(),
})

export const sales = sqliteTable('sales', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  namaPelanggan: text('nama_pelanggan'),
  metodePembayaran: text('metode_pembayaran', { enum: ['tunai', 'bon'] }).notNull(),
  status: text('status', { enum: ['selesai', 'dibatalkan'] }).notNull().default('selesai'),
  total: integer('total').notNull().default(0),
  dibayar: integer('dibayar').notNull().default(0),
  ...timestamps(),
})

export const saleItems = sqliteTable('sale_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  productUnitId: integer('product_unit_id').references(() => productUnits.id, { onDelete: 'set null' }),
  qty: integer('qty').notNull(),
  konversi: integer('konversi').notNull().default(1),
  satuan: text('satuan'),
  hargaJual: integer('harga_jual').notNull(),
  hargaPokok: integer('harga_pokok').notNull(),
  subtotal: integer('subtotal').notNull(),
  ...timestamps(),
})

export const bonPayments = sqliteTable('bon_payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  jumlah: integer('jumlah').notNull(),
  tanggal: text('tanggal').notNull(),
  keterangan: text('keterangan'),
  ...timestamps(),
})

export const stockAdjustments = sqliteTable('stock_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  stokSebelum: integer('stok_sebelum').notNull(),
  stokSesudah: integer('stok_sesudah').notNull(),
  selisih: integer('selisih').notNull(),
  alasan: text('alasan'),
  tanggal: text('tanggal').notNull(),
  ...timestamps(),
})

export const storeSettings = sqliteTable('store_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  namaToko: text('nama_toko').notNull(),
  alamat: text('alamat'),
  telepon: text('telepon'),
  pesanFooter: text('pesan_footer'),
  printerName: text('printer_name'),
  receiptWidth: text('receipt_width', { enum: ['58mm', '80mm'] }).notNull().default('58mm'),
  ...timestamps(),
})
