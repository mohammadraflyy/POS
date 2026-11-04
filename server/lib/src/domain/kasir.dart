import '../core/errors.dart';
import '../core/money.dart';
import '../core/qty.dart';
import '../db/db.dart';
import 'parties.dart';

enum MetodePembayaran {
  tunai,
  bon,
  qris,
  transfer;

  /// Settled in full at checkout, but the money never lands in the drawer.
  bool get isNonTunai => this == qris || this == transfer;

  static MetodePembayaran parse(Object? value) {
    for (final metode in values) {
      if (metode.name == value) {
        return metode;
      }
    }

    throw BusinessException('Metode pembayaran tidak valid.');
  }
}

class PriceTier {
  const PriceTier({required this.minQty, required this.maxQty, required this.hargaJual});

  final num minQty;

  /// Null means open-ended above [minQty].
  final num? maxQty;
  final int hargaJual;
}

/// Tiers are closed [minQty, maxQty] ranges. Old data may hold overlapping open-ended
/// tiers ("10+" and "50+"), so the highest satisfied minQty wins, which prices them the
/// way they always were.
PriceTier? findTierForQty(List<PriceTier> tiers, num qty) {
  final sorted = [...tiers]..sort((a, b) => b.minQty.compareTo(a.minQty));

  for (final tier in sorted) {
    if (qty >= tier.minQty && (tier.maxQty == null || qty <= tier.maxQty!)) {
      return tier;
    }
  }

  return null;
}

/// What a line is worth before any discount - qty may be fractional, prices are cents.
int lineGross(num qty, int hargaJual) => (qty * hargaJual).round();

class CartItemInput {
  const CartItemInput({required this.productId, this.productUnitId, required this.qty, this.hargaJual, this.diskon});

  final int productId;

  /// Null means the product's base unit.
  final int? productUnitId;
  final num qty;

  /// Cents; overrides master and tier pricing for this line alone.
  final int? hargaJual;

  /// Cents off this line alone, on top of any bill-wide discount.
  final int? diskon;
}

class ResolvedItem {
  ResolvedItem({
    required this.productId,
    required this.productUnitId,
    required this.satuan,
    required this.konversi,
    required this.hargaJual,
    required this.hargaPokok,
    required this.qty,
    required this.qtyDasar,
    required this.priceSource,
    required this.diskon,
    required this.stokCukup,
  });

  final int productId;
  final int productUnitId;
  final String satuan;
  final int konversi;
  final int hargaJual;
  int hargaPokok;
  final num qty;
  final num qtyDasar;
  String priceSource;
  final int diskon;
  bool stokCukup;

  /// What the line contributes to the bill: its gross less its own manual discount.
  int get subtotal => lineGross(qty, hargaJual) - diskon;
}

class _UnitForSale {
  _UnitForSale(Row row)
      : id = row['id'] as int,
        productId = row['product_id'] as int,
        unitCode = row['unit_code'] as String,
        conversionFactor = row['conversion_factor'] as int,
        hargaJual = row['harga_jual'] as int,
        hargaPokok = row['harga_pokok'] as int,
        isBaseUnit = asBool(row['is_base_unit']);

  final int id;
  final int productId;
  final String unitCode;
  final int conversionFactor;
  final int hargaJual;
  int hargaPokok;
  final bool isBaseUnit;
}

String _placeholders(int count) => List.filled(count, '?').join(', ');

/// Turns cart lines into priced, stock-checked sale lines. With [allowStockShortage] a
/// shortfall is reported as `stokCukup: false` instead of thrown - the mobile cart
/// preview needs the rest of the cart priced even when one line cannot be filled.
///
/// [savedItems] are the lines a sale being edited already had: a line kept at its saved
/// price keeps its saved cost and price source, so correcting an old sale never rewrites
/// its historical margin.
List<ResolvedItem> _resolveItems(Db db, List<CartItemInput> items, {bool allowStockShortage = false, List<Row> savedItems = const []}) {
  final productIds = items.map((item) => item.productId).toSet().toList();
  final placeholders = _placeholders(productIds.length);
  final productsById = {for (final row in db.select('SELECT id, nama_item, stok FROM products WHERE id IN ($placeholders)', productIds)) row['id'] as int: row};
  final unitRows = [
    for (final row in db.select(
      'SELECT pu.id, pu.product_id, u.code AS unit_code, pu.conversion_factor, pu.harga_jual, pu.harga_pokok, pu.is_base_unit '
      'FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id IN ($placeholders)',
      productIds,
    ))
      _UnitForSale(row),
  ];
  final tierRows = db.select('SELECT * FROM product_price_tiers WHERE product_id IN ($placeholders)', productIds);
  final resolved = <ResolvedItem>[];
  final qtyDasarByProduct = <int, num>{};

  for (final item in items) {
    final product = productsById[item.productId];

    if (product == null) {
      throw BusinessException('Produk tidak ditemukan.');
    }

    final namaItem = product['nama_item'] as String;
    final stok = product['stok'] as num;
    final unit = unitRows.where((row) => item.productUnitId != null
        ? row.id == item.productUnitId && row.productId == item.productId
        : row.productId == item.productId && row.isBaseUnit).firstOrNull;

    if (unit == null) {
      throw BusinessException('Satuan tidak valid untuk $namaItem.');
    }

    // tiers hang off the unit being sold, so a DUS line prices against DUS tiers
    final tiers = [
      for (final row in tierRows.where((row) => row['product_unit_id'] == unit.id))
        PriceTier(minQty: row['min_qty'] as num, maxQty: row['max_qty'] as num?, hargaJual: row['harga_jual'] as int),
    ];

    final saved = savedItems
        .where((row) =>
            row['product_id'] == item.productId &&
            row['product_unit_id'] == unit.id &&
            (item.hargaJual == null || item.hargaJual == row['harga_jual']))
        .firstOrNull;

    // a saved price is already agreed, even when today's cost has risen above it
    final floor = saved == null ? unit.hargaPokok : _min(saved['harga_pokok'] as int, saved['harga_jual'] as int);
    final line = _resolveCartItem(
      productId: item.productId,
      namaItem: namaItem,
      stok: stok,
      unit: unit,
      costFloor: floor,
      tiers: tiers,
      qty: item.qty,
      hargaOverride: item.hargaJual ?? saved?['harga_jual'] as int?,
      diskon: item.diskon,
      allowStockShortage: allowStockShortage,
    );

    if (saved != null) {
      line.hargaPokok = saved['harga_pokok'] as int;
      line.priceSource = saved['price_source'] as String;
    }

    final totalQtyDasar = (qtyDasarByProduct[item.productId] ?? 0) + line.qtyDasar;

    if (stok < totalQtyDasar) {
      if (!allowStockShortage) {
        throw BusinessException('Stok $namaItem tidak cukup.');
      }

      // a line can look fine alone yet be unfillable combined with an earlier line
      line.stokCukup = false;
    }

    qtyDasarByProduct[item.productId] = totalQtyDasar;
    resolved.add(line);
  }

  return resolved;
}

int _min(int a, int b) => a < b ? a : b;

ResolvedItem _resolveCartItem({
  required int productId,
  required String namaItem,
  required num stok,
  required _UnitForSale unit,
  required int costFloor,
  required List<PriceTier> tiers,
  required num qty,
  required int? hargaOverride,
  required int? diskon,
  required bool allowStockShortage,
}) {
  final tier = findTierForQty(tiers, qty);
  final hargaJual = hargaOverride ?? tier?.hargaJual ?? unit.hargaJual;
  final priceSource = hargaOverride != null
      ? 'manual'
      : tier != null
          ? 'price_tier'
          : 'normal';

  // A price set by hand may not sell the line at a loss. Master and tier prices are the
  // owner's own decision, and the discount is a concession, not a mispricing.
  if (hargaOverride != null && hargaOverride < costFloor) {
    throw BusinessException('Harga $namaItem di bawah harga pokok satuan ${unit.unitCode}.');
  }

  final qtyDasar = bulatkanQty(qty * unit.conversionFactor);
  final stokCukup = stok >= qtyDasar;

  if (!stokCukup && !allowStockShortage) {
    throw BusinessException('Stok $namaItem tidak cukup.');
  }

  final diskonBaris = diskon ?? 0;

  if (diskonBaris < 0) {
    throw BusinessException('Diskon $namaItem tidak valid.');
  }

  if (diskonBaris > lineGross(qty, hargaJual)) {
    throw BusinessException('Diskon $namaItem melebihi harga barisnya.');
  }

  return ResolvedItem(
    productId: productId,
    productUnitId: unit.id,
    satuan: unit.unitCode,
    konversi: unit.conversionFactor,
    hargaJual: hargaJual,
    // the cost of the unit actually sold - a DUS line carries the DUS cost
    hargaPokok: unit.hargaPokok,
    qty: qty,
    qtyDasar: qtyDasar,
    priceSource: priceSource,
    diskon: diskonBaris,
    stokCukup: stokCukup,
  );
}

/// Rejecting rather than clamping: a discount larger than the bill means the cashier and
/// the till disagree about what is being sold.
void _assertDiskonNota(int diskon, int subtotal) {
  if (diskon < 0) {
    throw BusinessException('Diskon nota tidak valid.');
  }

  if (diskon > subtotal) {
    throw BusinessException('Diskon nota melebihi total belanja.');
  }
}

int _validateBiayaLain(int value) {
  if (value < 0) {
    throw BusinessException('Biaya lain-lain harus berupa nominal yang valid, minimal 0.');
  }

  return value;
}

void _assertItems(List<CartItemInput> items, {String emptyMessage = 'Keranjang tidak boleh kosong.'}) {
  if (items.isEmpty) {
    throw BusinessException(emptyMessage);
  }

  for (final item in items) {
    if (!(item.qty > 0)) {
      throw BusinessException('Qty harus lebih dari 0.');
    }
  }
}

/// Parses the local `YYYY-MM-DDTHH:mm` a `datetime-local` input produces. Any date is
/// allowed, past or future: a bon is filed under the day it is meant for.
DateTime parseTanggalTransaksi(String tanggal) {
  final parsed = DateTime.tryParse(tanggal);

  if (parsed == null) {
    throw BusinessException('Tanggal transaksi tidak valid.');
  }

  return parsed;
}

/// Prices a cart exactly like checkout would, without writing anything.
Map<String, Object?> previewCart(Db db, List<CartItemInput> items, {int? diskonNota}) {
  _assertItems(items);

  final lines = _resolveItems(db, items, allowStockShortage: true);
  final subtotal = lines.fold<int>(0, (sum, line) => sum + line.subtotal);
  final diskon = diskonNota ?? 0;

  _assertDiskonNota(diskon, subtotal);

  return {
    'lines': [
      for (final line in lines)
        {
          'productId': line.productId,
          'productUnitId': line.productUnitId,
          'satuan': line.satuan,
          'qty': line.qty,
          'hargaJual': rupiahJson(line.hargaJual),
          'diskon': rupiahJson(line.diskon),
          'subtotal': rupiahJson(line.subtotal),
          'priceSource': line.priceSource,
          'stokCukup': line.stokCukup,
        },
    ],
    'subtotal': rupiahJson(subtotal),
    'diskon': rupiahJson(diskon),
    'total': rupiahJson(subtotal - diskon),
  };
}

void _writeSaleLines(Db db, int saleId, List<ResolvedItem> lines, int createdAt, {Map<String, int> keepCost = const {}, int? updatedAt}) {
  for (final line in lines) {
    db.insert(
      'INSERT INTO sale_items (sale_id, product_id, product_unit_id, qty, konversi, base_quantity, satuan, harga_jual, harga_pokok, '
      'price_source, diskon, subtotal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        saleId,
        line.productId,
        line.productUnitId,
        line.qty,
        line.konversi,
        line.qtyDasar,
        line.satuan,
        line.hargaJual,
        keepCost['${line.productId}:${line.productUnitId}:${line.hargaJual}'] ??
            keepCost['${line.productId}:${line.productUnitId}'] ??
            line.hargaPokok,
        line.priceSource,
        line.diskon,
        line.subtotal,
        createdAt,
        updatedAt ?? createdAt,
      ],
    );

    db.execute('UPDATE products SET stok = round(stok - ?, $qtyDecimals) WHERE id = ?', [line.qtyDasar, line.productId]);
    db.insert(
      "INSERT INTO stock_movements (product_id, product_unit_id, quantity, conversion_factor, base_quantity, movement_type, reference_id, created_at) "
      "VALUES (?, ?, ?, ?, ?, 'sale', ?, ?)",
      [line.productId, line.productUnitId, -line.qty, line.konversi, -line.qtyDasar, saleId, createdAt],
    );
  }
}

/// Puts sold stock back and logs the reversal, so the ledger keeps summing to `stok`.
void _restoreStockForItems(Db db, int saleId, List<Row> items) {
  final now = nowSeconds();

  for (final item in items) {
    final qty = item['qty'] as num;
    final konversi = item['konversi'] as int;
    final qtyDasar = bulatkanQty(qty * konversi);

    db.execute('UPDATE products SET stok = round(stok + ?, $qtyDecimals) WHERE id = ?', [qtyDasar, item['product_id']]);
    db.insert(
      "INSERT INTO stock_movements (product_id, product_unit_id, quantity, conversion_factor, base_quantity, movement_type, reference_id, created_at) "
      "VALUES (?, ?, ?, ?, ?, 'sale_cancel', ?, ?)",
      [item['product_id'], item['product_unit_id'], qty, konversi, qtyDasar, saleId, now],
    );
  }
}

class CheckoutInput {
  const CheckoutInput({
    required this.metodePembayaran,
    required this.namaPelanggan,
    required this.dibayar,
    required this.userId,
    required this.items,
    this.tanggal,
    this.diskon,
    this.biayaLain,
    this.keterangan,
  });

  final MetodePembayaran metodePembayaran;
  final String? namaPelanggan;

  /// Cents.
  final int? dibayar;
  final int userId;

  /// Local `YYYY-MM-DDTHH:mm`; null stamps the sale with the current time.
  final String? tanggal;

  /// Cents off the whole bill, applied after every line's own discount.
  final int? diskon;

  /// Cents added to the bill.
  final int? biayaLain;
  final String? keterangan;
  final List<CartItemInput> items;
}

({int saleId, int total}) checkout(Db db, CheckoutInput input) {
  _assertItems(input.items);

  if (input.metodePembayaran == MetodePembayaran.bon && (input.namaPelanggan?.trim().isEmpty ?? true)) {
    throw BusinessException('Nama pelanggan wajib diisi untuk transaksi bon.');
  }

  final biayaLain = _validateBiayaLain(input.biayaLain ?? 0);

  return db.transaction(() {
    final lines = _resolveItems(db, input.items);
    final diskonNota = input.diskon ?? 0;

    _assertDiskonNota(diskonNota, lines.fold(0, (sum, line) => sum + line.subtotal));

    final createdAt = input.tanggal != null ? toEpochSeconds(parseTanggalTransaksi(input.tanggal!)) : nowSeconds();

    // bon can take a partial payment up front - the rest becomes debt, collected later
    final dibayarAwal = input.metodePembayaran == MetodePembayaran.tunai || input.metodePembayaran == MetodePembayaran.bon
        ? (input.dibayar ?? 0)
        : 0;

    if (dibayarAwal < 0) {
      throw BusinessException('Jumlah bayar tidak boleh negatif.');
    }

    final saleId = db.insert(
      "INSERT INTO sales (user_id, customer_id, nama_pelanggan, metode_pembayaran, status, diskon, biaya_lain, keterangan, total, dibayar, created_at, updated_at) "
      "VALUES (?, ?, ?, ?, 'selesai', ?, ?, ?, 0, ?, ?, ?)",
      [
        input.userId,
        findOrCreateCustomerByName(db, input.namaPelanggan ?? ''),
        input.namaPelanggan,
        input.metodePembayaran.name,
        diskonNota,
        biayaLain,
        _blankToNull(input.keterangan),
        dibayarAwal,
        createdAt,
        createdAt,
      ],
    );

    _writeSaleLines(db, saleId, lines, createdAt);

    final total = lines.fold<int>(0, (sum, line) => sum + line.subtotal) + biayaLain - diskonNota;

    // qris and transfer settle the exact amount - nothing owed, no change given
    db.execute('UPDATE sales SET total = ?, dibayar = ? WHERE id = ?', [total, input.metodePembayaran.isNonTunai ? total : dibayarAwal, saleId]);

    if (input.metodePembayaran == MetodePembayaran.tunai && dibayarAwal < total) {
      throw BusinessException('Uang bayar kurang dari total belanja.');
    }

    return (saleId: saleId, total: total);
  });
}

String? _blankToNull(String? value) {
  final trimmed = value?.trim();

  return trimmed == null || trimmed.isEmpty ? null : trimmed;
}

Row _requireSale(Db db, int saleId) {
  final sale = db.first('SELECT * FROM sales WHERE id = ?', [saleId]);

  if (sale == null) {
    throw BusinessException('Transaksi tidak ditemukan.');
  }

  return sale;
}

void cancelSale(Db db, int saleId) {
  final sale = _requireSale(db, saleId);

  if (sale['status'] == 'dibatalkan') {
    throw BusinessException('Transaksi sudah dibatalkan.');
  }

  if (db.first('SELECT id FROM bon_payments WHERE sale_id = ?', [saleId]) != null) {
    throw BusinessException('Tidak bisa membatalkan, bon sudah ada pembayaran.');
  }

  db.transaction(() {
    _restoreStockForItems(db, saleId, db.select('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]));
    db.execute("UPDATE sales SET status = 'dibatalkan', updated_at = ? WHERE id = ?", [nowSeconds(), saleId]);
  });
}

class UpdateSaleInput {
  const UpdateSaleInput({
    required this.metodePembayaran,
    required this.namaPelanggan,
    required this.dibayar,
    required this.tanggal,
    required this.userId,
    required this.items,
    this.diskon,
    this.biayaLain,
    this.keterangan,
  });

  final MetodePembayaran metodePembayaran;
  final String? namaPelanggan;

  /// Cents; ignored for qris and transfer, which always settle in full.
  final int? dibayar;
  final String tanggal;
  final int userId;
  final List<CartItemInput> items;
  final int? diskon;

  /// Null keeps the sale's current charge.
  final int? biayaLain;

  /// The sale's note, which doubles as the reason logged for this edit.
  final String? keterangan;
}

/// Rewrites a saved sale in place. The old lines are reversed inside the transaction
/// before the new ones are priced, which is what lets the cashier raise the qty of
/// something this very sale sold out. A line already on the sale keeps its cost.
int updateSale(Db db, int saleId, UpdateSaleInput input) {
  _assertItems(input.items);

  if (input.metodePembayaran == MetodePembayaran.bon && (input.namaPelanggan?.trim().isEmpty ?? true)) {
    throw BusinessException('Nama pelanggan wajib diisi untuk transaksi bon.');
  }

  final tanggalBaru = toEpochSeconds(parseTanggalTransaksi(input.tanggal));
  final sale = _requireSale(db, saleId);

  // cancelSale already gave the stock back but left the lines, so reversing them again
  // here would hand the same goods back twice
  if (sale['status'] != 'selesai') {
    throw BusinessException('Transaksi yang dibatalkan tidak bisa diubah.');
  }

  final sudahDibayar = db.scalar<int>('SELECT coalesce(sum(jumlah), 0) FROM bon_payments WHERE sale_id = ?', [saleId]) ?? 0;

  return db.transaction(() {
    final oldItems = db.select('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]);
    final biayaLain = _validateBiayaLain(input.biayaLain ?? sale['biaya_lain'] as int);

    _restoreStockForItems(db, saleId, oldItems);
    db.execute('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);

    final lines = _resolveItems(db, input.items, savedItems: oldItems);
    final diskonNota = input.diskon ?? 0;

    _assertDiskonNota(diskonNota, lines.fold(0, (sum, line) => sum + line.subtotal));

    final keepCost = <String, int>{
      for (final item in oldItems) '${item['product_id']}:${item['product_unit_id']}': item['harga_pokok'] as int,
      for (final item in oldItems) '${item['product_id']}:${item['product_unit_id']}:${item['harga_jual']}': item['harga_pokok'] as int,
    };
    final now = nowSeconds();

    _writeSaleLines(db, saleId, lines, tanggalBaru, keepCost: keepCost, updatedAt: now);

    final total = lines.fold<int>(0, (sum, line) => sum + line.subtotal) + biayaLain - diskonNota;

    // for bon, dibayar may sit above the recorded bon_payments - deliberate, so an admin
    // can correct money that was taken but never entered
    final dibayarBaru = input.metodePembayaran.isNonTunai ? total : (input.dibayar ?? 0);

    if (input.metodePembayaran == MetodePembayaran.tunai && dibayarBaru < total) {
      throw BusinessException('Uang bayar kurang dari total belanja.');
    }

    if (dibayarBaru < sudahDibayar) {
      throw BusinessException('Dibayar tidak boleh kurang dari pembayaran yang sudah tercatat.');
    }

    db.execute(
      'UPDATE sales SET customer_id = ?, nama_pelanggan = ?, metode_pembayaran = ?, diskon = ?, biaya_lain = ?, keterangan = ?, '
      'total = ?, dibayar = ?, created_at = ?, updated_at = ? WHERE id = ?',
      [
        findOrCreateCustomerByName(db, input.namaPelanggan ?? ''),
        input.namaPelanggan,
        input.metodePembayaran.name,
        diskonNota,
        biayaLain,
        _blankToNull(input.keterangan),
        total,
        dibayarBaru,
        tanggalBaru,
        now,
        saleId,
      ],
    );

    // inside the same transaction: a log describing a change that never happened would
    // be worse than no log
    db.insert(
      'INSERT INTO sale_edits (sale_id, user_id, keterangan, total_sebelum, total_sesudah, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [saleId, input.userId, input.keterangan?.trim() ?? '', sale['total'], total, now, now],
    );

    return total;
  });
}

/// Appends lines to an unpaid bon: the customer took more goods on the same tab. The new
/// lines carry today's date while the sale keeps its own - the debt is still the old debt.
int addItemsToSale(Db db, int saleId, List<CartItemInput> items) {
  _assertItems(items, emptyMessage: 'Tidak ada item yang ditambahkan.');

  final sale = _requireSale(db, saleId);

  if (sale['status'] != 'selesai') {
    throw BusinessException('Transaksi yang dibatalkan tidak bisa ditambah item.');
  }

  if (sale['metode_pembayaran'] != 'bon') {
    throw BusinessException('Hanya transaksi bon yang bisa ditambah item.');
  }

  if ((sale['dibayar'] as int) >= (sale['total'] as int)) {
    throw BusinessException('Bon sudah lunas, tidak bisa ditambah item.');
  }

  return db.transaction(() {
    final lines = _resolveItems(db, items);
    final now = nowSeconds();

    _writeSaleLines(db, saleId, lines, now);

    final total = (sale['total'] as int) + lines.fold<int>(0, (sum, line) => sum + line.subtotal);
    db.execute('UPDATE sales SET total = ?, updated_at = ? WHERE id = ?', [total, now, saleId]);

    return total;
  });
}

/// Removes a sale entirely. A paid bon goes too, instalments and all, since
/// `bon_payments` cascades off `sales`.
void deleteSale(Db db, int saleId) {
  final sale = _requireSale(db, saleId);

  db.transaction(() {
    // a cancelled sale already gave its stock back
    if (sale['status'] != 'dibatalkan') {
      _restoreStockForItems(db, saleId, db.select('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]));
    }

    db.execute('DELETE FROM sales WHERE id = ?', [saleId]);
  });
}

Map<String, int> purgeTodaySales(Db db) {
  final now = DateTime.now();
  final start = toEpochSeconds(DateTime(now.year, now.month, now.day));
  final end = toEpochSeconds(DateTime(now.year, now.month, now.day, 23, 59, 59));
  var deleted = 0;
  var skipped = 0;

  db.transaction(() {
    for (final sale in db.select('SELECT * FROM sales WHERE created_at >= ? AND created_at <= ?', [start, end])) {
      final saleId = sale['id'] as int;

      if (db.first('SELECT id FROM bon_payments WHERE sale_id = ?', [saleId]) != null) {
        skipped++;
        continue;
      }

      if (sale['status'] != 'dibatalkan') {
        _restoreStockForItems(db, saleId, db.select('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]));
      }

      db.execute('DELETE FROM sales WHERE id = ?', [saleId]);
      deleted++;
    }
  });

  return {'deleted': deleted, 'skipped': skipped};
}

/// Deletes every sale created before [before]. Stock is left alone - these are old
/// records being archived away, not sales being undone.
int purgeSalesBefore(Db db, DateTime before) {
  final now = DateTime.now();

  if (before.isAfter(DateTime(now.year, now.month, now.day, 23, 59, 59, 999))) {
    throw BusinessException('Tanggal tidak boleh di masa depan.');
  }

  return db.execute('DELETE FROM sales WHERE created_at < ?', [toEpochSeconds(before)]);
}

String _localDate(DateTime time) =>
    '${time.year}-${time.month.toString().padLeft(2, '0')}-${time.day.toString().padLeft(2, '0')}';

void recordBonPayment(Db db, int saleId, int jumlah, String? keterangan) {
  final sale = _requireSale(db, saleId);

  if (sale['metode_pembayaran'] != 'bon' || sale['status'] != 'selesai') {
    throw BusinessException('Transaksi ini bukan bon aktif.');
  }

  if (jumlah <= 0) {
    throw BusinessException('Jumlah bayar harus lebih dari 0.');
  }

  final note = _blankToNull(keterangan);

  if (note != null && note.length > 500) {
    throw BusinessException('Keterangan maksimal 500 karakter.');
  }

  if (jumlah > (sale['total'] as int) - (sale['dibayar'] as int)) {
    throw BusinessException('Jumlah bayar melebihi sisa piutang.');
  }

  final now = DateTime.now();

  db.transaction(() {
    db.insert(
      'INSERT INTO bon_payments (sale_id, jumlah, tanggal, keterangan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [saleId, jumlah, _localDate(now), note, toEpochSeconds(now), toEpochSeconds(now)],
    );
    db.execute('UPDATE sales SET dibayar = dibayar + ? WHERE id = ?', [jumlah, saleId]);
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const _catalogPageSize = 25;
const _catalogValidPageSizes = [10, 25, 50, 100];

/// A paginated, searchable catalog for selling: active products with every unit and
/// price tier, so a client can show prices without pricing anything itself.
Map<String, Object?> searchCatalogForSale(Db db, {String? q, int page = 1, int? pageSize}) {
  final size = pageSize != null && _catalogValidPageSizes.contains(pageSize) ? pageSize : _catalogPageSize;
  final currentPage = page < 1 ? 1 : page;
  final query = q?.trim() ?? '';
  final where = query.isEmpty ? 'WHERE is_active = 1' : 'WHERE is_active = 1 AND (kode_item LIKE ? OR nama_item LIKE ? OR barcode LIKE ?)';
  final params = query.isEmpty ? <Object?>[] : List<Object?>.filled(3, '%$query%');
  final total = db.scalar<int>('SELECT count(*) FROM products $where', params) ?? 0;
  final productRows = db.select('SELECT * FROM products $where ORDER BY nama_item LIMIT ? OFFSET ?', [...params, size, (currentPage - 1) * size]);
  final ids = [for (final row in productRows) row['id'] as int];
  final unitRows = ids.isEmpty
      ? <Row>[]
      : db.select(
          'SELECT pu.id, pu.product_id, u.code AS satuan, pu.conversion_factor AS konversi, pu.harga_jual, pu.harga_pokok, pu.is_base_unit '
          'FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id IN (${_placeholders(ids.length)}) ORDER BY pu.conversion_factor, pu.id',
          ids,
        );
  final tierRows = ids.isEmpty
      ? <Row>[]
      : db.select('SELECT * FROM product_price_tiers WHERE product_id IN (${_placeholders(ids.length)}) ORDER BY product_unit_id, min_qty', ids);

  return {
    'data': [
      for (final product in productRows)
        () {
          final base = unitRows.where((u) => u['product_id'] == product['id'] && asBool(u['is_base_unit'])).firstOrNull;

          return {
            'id': product['id'],
            'kodeItem': product['kode_item'],
            'barcode': product['barcode'],
            'namaItem': product['nama_item'],
            'satuan': base?['satuan'] ?? '',
            'hargaJual': rupiahJson(product['harga_jual'] as int),
            'hargaPokok': rupiahJson((base?['harga_pokok'] ?? product['harga_pokok']) as int),
            'stok': product['stok'],
            'baseProductUnitId': base?['id'] ?? 0,
            'productUnits': [
              for (final unit in unitRows.where((u) => u['product_id'] == product['id'] && !asBool(u['is_base_unit'])))
                {
                  'id': unit['id'],
                  'satuan': unit['satuan'],
                  'konversi': unit['konversi'],
                  'hargaJual': rupiahJson(unit['harga_jual'] as int),
                  'hargaPokok': rupiahJson(unit['harga_pokok'] as int),
                },
            ],
            'priceTiers': [
              for (final tier in tierRows.where((t) => t['product_id'] == product['id']))
                {
                  'productUnitId': tier['product_unit_id'],
                  'minQty': tier['min_qty'],
                  'maxQty': tier['max_qty'],
                  'hargaJual': rupiahJson(tier['harga_jual'] as int),
                },
            ],
          };
        }(),
    ],
    'currentPage': currentPage,
    'lastPage': total == 0 ? 1 : (total / size).ceil(),
    'total': total,
  };
}

String _iso(Object? seconds) => fromEpochSeconds(seconds as int).toIso8601String();

Map<int, String> _productNames(Db db, Iterable<Object?> ids) {
  final unique = ids.toSet().toList();

  if (unique.isEmpty) {
    return {};
  }

  return {
    for (final row in db.select('SELECT id, nama_item FROM products WHERE id IN (${_placeholders(unique.length)})', unique))
      row['id'] as int: row['nama_item'] as String,
  };
}

/// hargaPokok is the cost of the unit that was sold, so qty alone scales it.
int _modal(Iterable<Row> items) => items.fold(0, (sum, item) => sum + ((item['qty'] as num) * (item['harga_pokok'] as int)).round());

Map<String, Object?> listSalesHistory(
  Db db, {
  String? dari,
  String? sampai,
  String? status,
  String? metodePembayaran,
  String? search,
  int page = 1,
}) {
  const pageSize = 20;
  final currentPage = page < 1 ? 1 : page;
  final conditions = <String>[];
  final params = <Object?>[];

  if (dari != null && dari.isNotEmpty) {
    conditions.add('created_at >= ?');
    params.add(toEpochSeconds(DateTime.parse('${dari}T00:00:00')));
  }

  if (sampai != null && sampai.isNotEmpty) {
    conditions.add('created_at <= ?');
    params.add(toEpochSeconds(DateTime.parse('${sampai}T23:59:59')));
  }

  if (status != null && status.isNotEmpty) {
    conditions.add('status = ?');
    params.add(status);
  }

  if (metodePembayaran != null && metodePembayaran.isNotEmpty) {
    conditions.add('metode_pembayaran = ?');
    params.add(metodePembayaran);
  }

  if (search != null && search.isNotEmpty) {
    conditions.add(
      '(nama_pelanggan LIKE ? OR id IN (SELECT si.sale_id FROM sale_items si JOIN products p ON p.id = si.product_id WHERE p.nama_item LIKE ?))',
    );
    params.addAll(['%$search%', '%$search%']);
  }

  final where = conditions.isEmpty ? '' : 'WHERE ${conditions.join(' AND ')}';
  final total = db.scalar<int>('SELECT count(*) FROM sales $where', params) ?? 0;
  final saleRows = db.select('SELECT * FROM sales $where ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [...params, pageSize, (currentPage - 1) * pageSize]);
  final saleIds = [for (final sale in saleRows) sale['id']];
  final itemRows = saleIds.isEmpty ? <Row>[] : db.select('SELECT * FROM sale_items WHERE sale_id IN (${_placeholders(saleIds.length)}) ORDER BY id', saleIds);
  final names = _productNames(db, itemRows.map((item) => item['product_id']));

  return {
    'data': [
      for (final sale in saleRows)
        () {
          final items = itemRows.where((item) => item['sale_id'] == sale['id']).toList();

          return {
            'id': sale['id'],
            'createdAt': _iso(sale['created_at']),
            'namaPelanggan': sale['nama_pelanggan'],
            'metodePembayaran': sale['metode_pembayaran'],
            'status': sale['status'],
            'total': rupiahJson(sale['total'] as int),
            'dibayar': rupiahJson(sale['dibayar'] as int),
            'laba': rupiahJson((sale['total'] as int) - _modal(items)),
            'items': [for (final item in items) {'namaItem': names[item['product_id']] ?? '', 'qty': item['qty']}],
          };
        }(),
    ],
    'currentPage': currentPage,
    'lastPage': total == 0 ? 1 : (total / pageSize).ceil(),
    'total': total,
  };
}

Map<String, Object?> getSaleDetail(Db db, int saleId) {
  final sale = _requireSale(db, saleId);
  final itemRows = db.select('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [saleId]);
  final names = _productNames(db, itemRows.map((item) => item['product_id']));
  final payments = db.select('SELECT * FROM bon_payments WHERE sale_id = ? ORDER BY tanggal DESC, id DESC', [saleId]);
  final kasirName = sale['user_id'] == null ? null : db.scalar<String>('SELECT name FROM users WHERE id = ?', [sale['user_id']]);
  final modal = _modal(itemRows);
  final edits = db.select(
    'SELECT e.*, u.name AS kasir_name FROM sale_edits e LEFT JOIN users u ON u.id = e.user_id WHERE e.sale_id = ? ORDER BY e.id DESC',
    [saleId],
  );

  return {
    'id': sale['id'],
    'namaPelanggan': sale['nama_pelanggan'],
    'metodePembayaran': sale['metode_pembayaran'],
    'status': sale['status'],
    'diskon': rupiahJson(sale['diskon'] as int),
    'biayaLain': rupiahJson(sale['biaya_lain'] as int),
    'total': rupiahJson(sale['total'] as int),
    'dibayar': rupiahJson(sale['dibayar'] as int),
    'keterangan': sale['keterangan'],
    'createdAt': _iso(sale['created_at']),
    'kasirName': kasirName,
    'modal': rupiahJson(modal),
    'laba': rupiahJson((sale['total'] as int) - modal),
    'items': [
      for (final item in itemRows)
        {
          'id': item['id'],
          'productId': item['product_id'],
          'productUnitId': item['product_unit_id'],
          'qty': item['qty'],
          'satuan': item['satuan'],
          'namaItem': names[item['product_id']] ?? '',
          'hargaJual': rupiahJson(item['harga_jual'] as int),
          'diskon': rupiahJson(item['diskon'] as int),
          'subtotal': rupiahJson(item['subtotal'] as int),
          'priceSource': item['price_source'],
        },
    ],
    'bonPayments': [
      for (final payment in payments)
        {'id': payment['id'], 'jumlah': rupiahJson(payment['jumlah'] as int), 'tanggal': payment['tanggal'], 'keterangan': payment['keterangan']},
    ],
    'edits': [
      for (final edit in edits)
        {
          'id': edit['id'],
          'keterangan': edit['keterangan'],
          'kasirName': edit['kasir_name'],
          'totalSebelum': rupiahJson(edit['total_sebelum'] as int),
          'totalSesudah': rupiahJson(edit['total_sesudah'] as int),
          'createdAt': _iso(edit['created_at']),
        },
    ],
  };
}

/// A saved sale in the shape the edit form loads.
Map<String, Object?> getSaleForEdit(Db db, int saleId) {
  final sale = _requireSale(db, saleId);

  return {
    'id': sale['id'],
    'namaPelanggan': sale['nama_pelanggan'],
    'metodePembayaran': sale['metode_pembayaran'],
    'status': sale['status'],
    'diskon': rupiahJson(sale['diskon'] as int),
    'biayaLain': rupiahJson(sale['biaya_lain'] as int),
    'dibayar': rupiahJson(sale['dibayar'] as int),
    'keterangan': sale['keterangan'],
    'createdAt': _iso(sale['created_at']),
    'items': [
      for (final item in db.select('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [saleId]))
        {
          'productId': item['product_id'],
          'productUnitId': item['product_unit_id'],
          'qty': item['qty'],
          'hargaJual': rupiahJson(item['harga_jual'] as int),
          'diskon': rupiahJson(item['diskon'] as int),
          'priceSource': item['price_source'],
        },
    ],
  };
}

/// The struk, in cents, for the ESC/POS builder.
class ReceiptData {
  const ReceiptData({
    required this.saleId,
    required this.createdAt,
    required this.metodePembayaran,
    required this.namaPelanggan,
    required this.kasirName,
    required this.items,
    required this.diskon,
    required this.biayaLain,
    required this.total,
    required this.dibayar,
    required this.keterangan,
  });

  final int saleId;
  final DateTime createdAt;
  final String metodePembayaran;
  final String? namaPelanggan;
  final String? kasirName;
  final List<ReceiptLine> items;
  final int diskon;
  final int biayaLain;
  final int total;
  final int dibayar;
  final String? keterangan;
}

class ReceiptLine {
  const ReceiptLine({required this.namaItem, required this.qty, required this.satuan, required this.hargaJual, required this.diskon, required this.subtotal});

  final String namaItem;
  final num qty;
  final String? satuan;
  final int hargaJual;
  final int diskon;
  final int subtotal;
}

ReceiptData getReceipt(Db db, int saleId) {
  final sale = _requireSale(db, saleId);
  final itemRows = db.select('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [saleId]);
  final names = _productNames(db, itemRows.map((item) => item['product_id']));
  final kasirName = sale['user_id'] == null ? null : db.scalar<String>('SELECT name FROM users WHERE id = ?', [sale['user_id']]);

  return ReceiptData(
    saleId: saleId,
    createdAt: fromEpochSeconds(sale['created_at'] as int),
    metodePembayaran: sale['metode_pembayaran'] as String,
    namaPelanggan: sale['nama_pelanggan'] as String?,
    kasirName: kasirName,
    diskon: sale['diskon'] as int,
    biayaLain: sale['biaya_lain'] as int,
    total: sale['total'] as int,
    dibayar: sale['dibayar'] as int,
    keterangan: sale['keterangan'] as String?,
    items: [
      for (final item in itemRows)
        ReceiptLine(
          namaItem: names[item['product_id']] ?? '',
          qty: item['qty'] as num,
          satuan: item['satuan'] as String?,
          hargaJual: item['harga_jual'] as int,
          diskon: item['diskon'] as int,
          subtotal: item['subtotal'] as int,
        ),
    ],
  );
}

/// Every active product with its units and tiers, for a till that keeps the whole
/// catalog in memory (the desktop kasir screen).
List<Map<String, Object?>> listProductsForKasir(Db db) {
  final result = searchCatalogForSale(db, page: 1, pageSize: 100);
  final total = result['total'] as int;

  if (total <= 100) {
    return (result['data'] as List).cast<Map<String, Object?>>();
  }

  final all = <Map<String, Object?>>[];

  for (var page = 1; page <= (total / 100).ceil(); page++) {
    all.addAll((searchCatalogForSale(db, page: page, pageSize: 100)['data'] as List).cast<Map<String, Object?>>());
  }

  return all;
}
