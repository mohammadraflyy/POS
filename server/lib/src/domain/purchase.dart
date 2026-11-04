import '../core/errors.dart';
import '../core/money.dart';
import '../core/qty.dart';
import '../db/db.dart';
import 'inventory_units.dart';

/// Weighted-average cost of one `konversi`-sized unit after receiving [qtyDasarMasuk]
/// base units worth [nilaiBeli]. Works on inventory value rather than a per-unit price so
/// a derived-unit purchase is not rounded twice on its way between units.
int hitungHargaPokokSatuan(num stokDasarLama, int hargaPokokSatuanLama, int konversi, num qtyDasarMasuk, int nilaiBeli) {
  // negative stock (possible after a manual adjustment) carries no value to average against
  final basisStok = stokDasarLama < 0 ? 0 : stokDasarLama;
  final totalQty = basisStok + qtyDasarMasuk;

  if (totalQty <= 0) {
    return hargaPokokSatuanLama;
  }

  return ((basisStok * hargaPokokSatuanLama + nilaiBeli * konversi) / totalQty).round();
}

/// The base-unit case of [hitungHargaPokokSatuan], kept for `products.harga_pokok`.
int hitungHargaPokokRataRata(num stokLama, int hargaPokokLama, num qtyDasar, int nilaiBeli) =>
    hitungHargaPokokSatuan(stokLama, hargaPokokLama, 1, qtyDasar, nilaiBeli);

/// Undoes one [hitungHargaPokokSatuan] step against today's figures. It cannot replay
/// history, but it guarantees inventory value drops by exactly what the purchase added.
int balikHargaPokokSatuan(num stokDasarSekarang, int hargaPokokSatuanSekarang, int konversi, num qtyDasarKeluar, int nilaiBeli) {
  final stokSisa = stokDasarSekarang - qtyDasarKeluar;

  // nothing left to carry the value: the current average is the best guess there is
  if (stokSisa <= 0) {
    return hargaPokokSatuanSekarang;
  }

  // clamped: reversing a purchase whose goods were already sold can go negative, and a
  // negative cost would poison every later margin
  final value = ((stokDasarSekarang * hargaPokokSatuanSekarang - nilaiBeli * konversi) / stokSisa).round();

  return value < 0 ? 0 : value;
}

class PurchaseItemInput {
  const PurchaseItemInput({required this.productId, this.productUnitId, required this.qty, required this.hargaBeli, this.hargaJual});

  final int productId;

  /// Null means the product's base unit.
  final int? productUnitId;
  final num qty;

  /// Cents per unit.
  final int hargaBeli;

  /// Cents; an optional new selling price for the purchased unit, set with the purchase.
  final int? hargaJual;
}

class PurchaseInput {
  const PurchaseInput({required this.supplierId, required this.tanggal, required this.catatan, required this.items, required this.userId, this.dibayar});

  final int? supplierId;

  /// `YYYY-MM-DD`.
  final String tanggal;
  final String? catatan;
  final List<PurchaseItemInput> items;
  final int? userId;

  /// Cents paid on arrival; null means the whole invoice was settled.
  final int? dibayar;
}

class _ResolvedLine {
  _ResolvedLine(this.productId, this.productUnitId, this.resolvedUnitId, this.qty, this.konversi, this.satuan, this.hargaBeli)
      : subtotal = (qty * hargaBeli).round();

  final int productId;
  final int? productUnitId;

  /// The product_units row the line resolved to, even when the input said null (base).
  final int resolvedUnitId;
  final num qty;
  final int konversi;
  final String satuan;
  final int hargaBeli;
  final int subtotal;
}

class _UnitRow {
  _UnitRow(Row row)
      : id = row['id'] as int,
        productId = row['product_id'] as int,
        satuan = row['satuan'] as String,
        konversi = row['konversi'] as int,
        hargaPokok = row['harga_pokok'] as int,
        parentUnitId = row['parent_unit_id'] as int?,
        isBaseUnit = asBool(row['is_base_unit']);

  final int id;
  final int productId;
  final String satuan;
  final int konversi;
  final int hargaPokok;
  final int? parentUnitId;
  final bool isBaseUnit;

  UnitTreeNode get node => UnitTreeNode(id: id, parentUnitId: parentUnitId, isBaseUnit: isBaseUnit);
}

String _placeholders(int count) => List.filled(count, '?').join(', ');

List<_UnitRow> _unitRows(Db db, List<int> productIds) {
  if (productIds.isEmpty) {
    return [];
  }

  return [
    for (final row in db.select(
      'SELECT pu.id, pu.product_id, u.code AS satuan, pu.conversion_factor AS konversi, pu.harga_pokok, pu.parent_unit_id, pu.is_base_unit '
      'FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id IN (${_placeholders(productIds.length)})',
      productIds,
    ))
      _UnitRow(row),
  ];
}

/// Cost travels inward, never outward: the goods arrived inside the purchased packaging,
/// so the units it is built from follow this purchase. Larger units and siblings do not.
List<_UnitRow> _unitsCarryingCost(List<_UnitRow> chain, int resolvedUnitId) {
  final purchased = chain.where((row) => row.id == resolvedUnitId).firstOrNull;

  return purchased == null ? [] : [purchased, ...unitsInside(chain, resolvedUnitId, (row) => row.node)];
}

void _assertPurchaseInput(String tanggal, List<PurchaseItemInput> items) {
  if (tanggal.trim().isEmpty) {
    throw BusinessException('Tanggal wajib diisi.');
  }

  if (items.isEmpty) {
    throw BusinessException('Item pembelian tidak boleh kosong.');
  }

  for (final item in items) {
    // fractional buys are real (5,5 KG); only zero and negatives are rejected
    if (!isQtyValid(item.qty) || bulatkanQty(item.qty) <= 0) {
      throw BusinessException('Qty harus lebih dari 0.');
    }

    if (item.hargaBeli < 0) {
      throw BusinessException('Harga beli tidak boleh negatif.');
    }

    if (item.hargaJual != null && item.hargaJual! < 0) {
      throw BusinessException('Harga jual tidak boleh negatif.');
    }
  }
}

List<_ResolvedLine> _resolvePurchaseItems(Db db, List<PurchaseItemInput> items) {
  final productIds = items.map((item) => item.productId).toSet().toList();
  final names = {
    for (final row in db.select('SELECT id, nama_item FROM products WHERE id IN (${_placeholders(productIds.length)})', productIds))
      row['id'] as int: row['nama_item'] as String,
  };
  final units = _unitRows(db, productIds);

  return [
    for (final item in items)
      () {
        final name = names[item.productId];

        if (name == null) {
          throw BusinessException('Produk tidak ditemukan.');
        }

        final unit = units
            .where((row) => item.productUnitId != null
                ? row.id == item.productUnitId && row.productId == item.productId
                : row.productId == item.productId && row.isBaseUnit)
            .firstOrNull;

        if (unit == null) {
          throw BusinessException('Satuan tidak valid untuk $name.');
        }

        return _ResolvedLine(item.productId, item.productUnitId, unit.id, bulatkanQty(item.qty), unit.konversi, unit.satuan, item.hargaBeli);
      }(),
  ];
}

void _assertDibayar(int dibayar, int totalPembelian) {
  if (dibayar < 0) {
    throw BusinessException('Dibayar tidak boleh negatif.');
  }

  if (dibayar > totalPembelian) {
    throw BusinessException('Dibayar tidak boleh melebihi total pembelian.');
  }
}

void _recordCostHistory(Db db, int productId, int? userId, int lama, int baru, int now) {
  final hargaJual = db.scalar<int>('SELECT harga_jual FROM products WHERE id = ?', [productId]);

  if (hargaJual == null) {
    return;
  }

  // a purchase never touches the selling price - recorded unchanged so the audit row
  // still reads as a complete before/after snapshot
  db.insert(
    'INSERT INTO product_price_histories (product_id, user_id, harga_pokok_lama, harga_pokok_baru, harga_jual_lama, harga_jual_baru, created_at, updated_at) '
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [productId, userId, lama, baru, hargaJual, hargaJual, now, now],
  );
}

/// Writes the lines and moves everything they touch: stock, the running average cost of
/// the product and of every unit the goods arrived inside, the price history, and the
/// stock ledger. Lines for the same product compound, each averaging against the last.
int _applyPurchaseItems(Db db, int purchaseId, List<_ResolvedLine> lines, int? userId, int now) {
  final productIds = lines.map((line) => line.productId).toSet().toList();
  final productRows = db.select('SELECT id, stok, harga_pokok FROM products WHERE id IN (${_placeholders(productIds.length)})', productIds);
  final units = _unitRows(db, productIds);
  final stok = {for (final row in productRows) row['id'] as int: row['stok'] as num};
  final hargaPokok = {for (final row in productRows) row['id'] as int: row['harga_pokok'] as int};
  final hargaPokokUnit = {for (final unit in units) unit.id: unit.hargaPokok};
  var total = 0;

  for (final line in lines) {
    total += line.subtotal;

    final qtyDasar = bulatkanQty(line.qty * line.konversi);
    final stokLama = stok[line.productId] ?? 0;
    final hargaPokokLama = hargaPokok[line.productId] ?? 0;
    final hargaPokokBaru = hitungHargaPokokRataRata(stokLama, hargaPokokLama, qtyDasar, line.subtotal);

    stok[line.productId] = stokLama + qtyDasar;
    hargaPokok[line.productId] = hargaPokokBaru;

    db.insert(
      'INSERT INTO purchase_items (purchase_id, product_id, product_unit_id, qty, konversi, satuan, harga_beli, subtotal, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [purchaseId, line.productId, line.productUnitId, line.qty, line.konversi, line.satuan, line.hargaBeli, line.subtotal, now, now],
    );
    db.execute(
      'UPDATE products SET stok = round(stok + ?, $qtyDecimals), harga_pokok = ?, updated_at = ? WHERE id = ?',
      [qtyDasar, hargaPokokBaru, now, line.productId],
    );

    for (final unit in _unitsCarryingCost(units.where((u) => u.productId == line.productId).toList(), line.resolvedUnitId)) {
      final baru = hitungHargaPokokSatuan(stokLama, hargaPokokUnit[unit.id] ?? 0, unit.konversi, qtyDasar, line.subtotal);

      hargaPokokUnit[unit.id] = baru;
      db.execute('UPDATE product_units SET harga_pokok = ?, updated_at = ? WHERE id = ?', [baru, now, unit.id]);
    }

    if (hargaPokokBaru != hargaPokokLama) {
      _recordCostHistory(db, line.productId, userId, hargaPokokLama, hargaPokokBaru, now);
    }

    db.insert(
      "INSERT INTO stock_movements (product_id, product_unit_id, quantity, conversion_factor, base_quantity, movement_type, reference_id, created_at) "
      "VALUES (?, ?, ?, ?, ?, 'purchase', ?, ?)",
      [line.productId, line.resolvedUnitId, line.qty, line.konversi, qtyDasar, purchaseId, now],
    );
  }

  return total;
}

/// The mirror of [_applyPurchaseItems], unwinding newest-first so a purchase with two
/// lines for one product averages back out along the path it averaged in.
void _reversePurchaseItems(Db db, int purchaseId, int? userId, int now) {
  final items = db.select('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id', [purchaseId]);

  if (items.isEmpty) {
    return;
  }

  final productIds = items.map((item) => item['product_id'] as int).toSet().toList();
  final productRows = db.select('SELECT id, stok, harga_pokok FROM products WHERE id IN (${_placeholders(productIds.length)})', productIds);
  final units = _unitRows(db, productIds);
  final stok = {for (final row in productRows) row['id'] as int: row['stok'] as num};
  final hargaPokok = {for (final row in productRows) row['id'] as int: row['harga_pokok'] as int};
  final hargaPokokUnit = {for (final unit in units) unit.id: unit.hargaPokok};

  for (final item in items.reversed) {
    final productId = item['product_id'] as int;
    final qty = item['qty'] as num;
    final konversi = item['konversi'] as int;
    final subtotal = item['subtotal'] as int;

    // the stored konversi, not today's: the line gives back exactly what it added
    final qtyDasar = bulatkanQty(qty * konversi);
    final stokSekarang = stok[productId] ?? 0;
    final hargaPokokSekarang = hargaPokok[productId] ?? 0;
    final hargaPokokBaru = balikHargaPokokSatuan(stokSekarang, hargaPokokSekarang, 1, qtyDasar, subtotal);

    stok[productId] = stokSekarang - qtyDasar;
    hargaPokok[productId] = hargaPokokBaru;

    db.execute(
      'UPDATE products SET stok = round(stok - ?, $qtyDecimals), harga_pokok = ?, updated_at = ? WHERE id = ?',
      [qtyDasar, hargaPokokBaru, now, productId],
    );

    final chain = units.where((u) => u.productId == productId).toList();
    // a base line, or one whose satuan was deleted since, returns its value to the base row
    final resolvedUnitId = item['product_unit_id'] as int? ?? chain.where((u) => u.isBaseUnit).firstOrNull?.id ?? 0;

    for (final unit in _unitsCarryingCost(chain, resolvedUnitId)) {
      final baru = balikHargaPokokSatuan(stokSekarang, hargaPokokUnit[unit.id] ?? 0, unit.konversi, qtyDasar, subtotal);

      hargaPokokUnit[unit.id] = baru;
      db.execute('UPDATE product_units SET harga_pokok = ?, updated_at = ? WHERE id = ?', [baru, now, unit.id]);
    }

    if (hargaPokokBaru != hargaPokokSekarang) {
      _recordCostHistory(db, productId, userId, hargaPokokSekarang, hargaPokokBaru, now);
    }

    db.insert(
      "INSERT INTO stock_movements (product_id, product_unit_id, quantity, conversion_factor, base_quantity, movement_type, reference_id, created_at) "
      "VALUES (?, ?, ?, ?, ?, 'stock_adjustment', ?, ?)",
      [productId, item['product_unit_id'], -qty, konversi, -qtyDasar, purchaseId, now],
    );
  }

  db.execute('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
}

int recordPurchase(Db db, PurchaseInput input) {
  _assertPurchaseInput(input.tanggal, input.items);

  return db.transaction(() {
    final now = nowSeconds();
    final lines = _resolvePurchaseItems(db, input.items);
    final totalPembelian = lines.fold<int>(0, (sum, line) => sum + line.subtotal);
    final dibayar = input.dibayar ?? totalPembelian;

    _assertDibayar(dibayar, totalPembelian);

    final purchaseId = db.insert(
      'INSERT INTO purchases (supplier_id, user_id, tanggal, total, dibayar, catatan, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
      [input.supplierId, input.userId, input.tanggal, dibayar, input.catatan, now, now],
    );
    final total = _applyPurchaseItems(db, purchaseId, lines, input.userId, now);

    _applySellPrices(db, input.items, lines, input.userId, now);
    db.execute('UPDATE purchases SET total = ? WHERE id = ?', [total, purchaseId]);

    return purchaseId;
  });
}

/// Restates the selling price of each purchased unit that came with a `hargaJual`. Runs
/// after [_applyPurchaseItems] so the history row snapshots the cost the purchase just
/// produced. The base unit stays mirrored onto `products.harga_jual`; derived units only
/// carry their own.
void _applySellPrices(Db db, List<PurchaseItemInput> items, List<_ResolvedLine> lines, int? userId, int now) {
  for (var index = 0; index < items.length; index++) {
    final hargaJualBaru = items[index].hargaJual;

    if (hargaJualBaru == null) {
      continue;
    }

    final unitId = lines[index].resolvedUnitId;
    final unit = db.first('SELECT harga_jual, is_base_unit FROM product_units WHERE id = ?', [unitId]);

    if (unit == null || unit['harga_jual'] == hargaJualBaru) {
      continue;
    }

    db.execute('UPDATE product_units SET harga_jual = ?, updated_at = ? WHERE id = ?', [hargaJualBaru, now, unitId]);

    if (!asBool(unit['is_base_unit'])) {
      continue;
    }

    final productId = items[index].productId;
    final product = db.first('SELECT harga_pokok, harga_jual FROM products WHERE id = ?', [productId])!;

    db.execute('UPDATE products SET harga_jual = ?, updated_at = ? WHERE id = ?', [hargaJualBaru, now, productId]);
    db.insert(
      'INSERT INTO product_price_histories (product_id, user_id, harga_pokok_lama, harga_pokok_baru, harga_jual_lama, harga_jual_baru, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [productId, userId, product['harga_pokok'], product['harga_pokok'], product['harga_jual'], hargaJualBaru, now, now],
    );
  }
}

int _cicilan(Db db, int purchaseId) =>
    db.scalar<int>('SELECT coalesce(sum(jumlah), 0) FROM purchase_payments WHERE purchase_id = ?', [purchaseId]) ?? 0;

/// Rewrites a saved purchase in place. The old lines are reversed inside the transaction
/// before the new ones are priced. Instalments already paid survive: `dibayar` becomes the
/// new down payment plus whatever was paid since, so the total can never drop below them.
int updatePurchase(Db db, int purchaseId, PurchaseInput input) {
  _assertPurchaseInput(input.tanggal, input.items);

  if (db.first('SELECT id FROM purchases WHERE id = ?', [purchaseId]) == null) {
    throw BusinessException('Pembelian tidak ditemukan.');
  }

  final cicilan = _cicilan(db, purchaseId);

  return db.transaction(() {
    final now = nowSeconds();

    _reversePurchaseItems(db, purchaseId, input.userId, now);

    final lines = _resolvePurchaseItems(db, input.items);
    final total = lines.fold<int>(0, (sum, line) => sum + line.subtotal);

    if (cicilan > total) {
      throw BusinessException('Total pembelian tidak boleh lebih kecil dari cicilan yang sudah dibayar.');
    }

    final uangMuka = input.dibayar ?? total - cicilan;

    _assertDibayar(uangMuka, total - cicilan);
    _applyPurchaseItems(db, purchaseId, lines, input.userId, now);

    db.execute(
      'UPDATE purchases SET supplier_id = ?, tanggal = ?, catatan = ?, total = ?, dibayar = ?, updated_at = ? WHERE id = ?',
      [input.supplierId, input.tanggal, input.catatan, total, uangMuka + cicilan, now, purchaseId],
    );

    return total;
  });
}

/// Removes a purchase that should never have been recorded, taking its goods and value back
/// out of stock. Instalments cascade with it.
void deletePurchase(Db db, int purchaseId) {
  final userId = db.scalar<int>('SELECT user_id FROM purchases WHERE id = ?', [purchaseId]);

  if (db.first('SELECT id FROM purchases WHERE id = ?', [purchaseId]) == null) {
    throw BusinessException('Pembelian tidak ditemukan.');
  }

  db.transaction(() {
    _reversePurchaseItems(db, purchaseId, userId, nowSeconds());
    db.execute('DELETE FROM purchases WHERE id = ?', [purchaseId]);
  });
}

List<Map<String, Object?>> _derivedUnitsJson(Db db, int productId) => [
      for (final unit in listProductUnits(db, productId).where((u) => !u.isBaseUnit))
        {'id': unit.id, 'satuan': unit.unitCode, 'konversi': unit.conversionFactor, 'hargaPokok': rupiahJson(unit.hargaPokok), 'hargaJual': rupiahJson(unit.hargaJual)},
    ];

/// The saved purchase, in the shape the entry form fills itself from (rupiah).
Map<String, Object?> getPurchaseDetail(Db db, int purchaseId) {
  final purchase = db.first('SELECT * FROM purchases WHERE id = ?', [purchaseId]);

  if (purchase == null) {
    throw BusinessException('Pembelian tidak ditemukan.');
  }

  final rows = db.select(
    'SELECT pi.product_id, pi.product_unit_id, pi.qty, pi.harga_beli, p.kode_item, p.nama_item '
    'FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id',
    [purchaseId],
  );
  final cicilan = _cicilan(db, purchaseId);

  return {
    'id': purchase['id'],
    'supplierId': purchase['supplier_id'],
    'tanggal': purchase['tanggal'],
    'catatan': purchase['catatan'],
    'total': rupiahJson(purchase['total'] as int),
    'uangMuka': rupiahJson((purchase['dibayar'] as int) - cicilan),
    'cicilan': rupiahJson(cicilan),
    'items': [
      for (final row in rows)
        () {
          final productId = row['product_id'] as int;
          final base = getBaseProductUnit(db, productId);
          final units = _derivedUnitsJson(db, productId);

          return {
            'productId': productId,
            'kodeItem': row['kode_item'],
            'namaItem': row['nama_item'],
            'baseSatuan': base.unitCode,
            'baseHargaPokok': rupiahJson(base.hargaPokok),
            'units': units,
            // a satuan deleted since falls back to base, where the reversal returns its value
            'productUnitId': units.any((u) => u['id'] == row['product_unit_id']) ? row['product_unit_id'] : null,
            'qty': row['qty'],
            'hargaBeli': rupiahJson(row['harga_beli'] as int),
          };
        }(),
    ],
  };
}

const _defaultPageSize = 25;
const _validPageSizes = [10, 25, 50, 100];

Map<String, Object?> listPurchases(Db db, {int page = 1, int? pageSize, String? dari, String? sampai}) {
  final size = pageSize != null && _validPageSizes.contains(pageSize) ? pageSize : _defaultPageSize;
  final currentPage = page < 1 ? 1 : page;
  // tanggal is a plain YYYY-MM-DD string, so a lexical comparison is a correct range filter
  final conditions = <String>[];
  final params = <Object?>[];

  if (dari != null && dari.isNotEmpty) {
    conditions.add('pu.tanggal >= ?');
    params.add(dari);
  }

  if (sampai != null && sampai.isNotEmpty) {
    conditions.add('pu.tanggal <= ?');
    params.add(sampai);
  }

  final where = conditions.isEmpty ? '' : 'WHERE ${conditions.join(' AND ')}';
  final totals = db.first('SELECT count(*) AS n, coalesce(sum(pu.total), 0) AS total FROM purchases pu $where', params)!;
  final total = totals['n'] as int;
  final rows = db.select(
    'SELECT pu.id, pu.tanggal, pu.total, pu.dibayar, pu.catatan, s.nama AS supplier_name FROM purchases pu '
    'LEFT JOIN suppliers s ON s.id = pu.supplier_id $where ORDER BY pu.tanggal DESC, pu.id DESC LIMIT ? OFFSET ?',
    [...params, size, (currentPage - 1) * size],
  );
  final ids = [for (final row in rows) row['id']];
  final items = ids.isEmpty
      ? <Row>[]
      : db.select(
          'SELECT pi.purchase_id, pi.qty, p.nama_item FROM purchase_items pi JOIN products p ON p.id = pi.product_id '
          'WHERE pi.purchase_id IN (${_placeholders(ids.length)}) ORDER BY pi.id',
          ids,
        );

  return {
    'data': [
      for (final row in rows)
        {
          'id': row['id'],
          'tanggal': row['tanggal'],
          'total': rupiahJson(row['total'] as int),
          'dibayar': rupiahJson(row['dibayar'] as int),
          'sisa': rupiahJson((row['total'] as int) - (row['dibayar'] as int)),
          'catatan': row['catatan'],
          'supplierName': row['supplier_name'],
          'itemSummary': items.where((i) => i['purchase_id'] == row['id']).map((i) => '${i['nama_item']} x${i['qty']}').join(', '),
        },
    ],
    'currentPage': currentPage,
    'lastPage': total == 0 ? 1 : (total / size).ceil(),
    'total': total,
    'totalKeseluruhan': rupiahJson(totals['total'] as int),
  };
}

Map<String, Object?> _productOption(Db db, Row row) {
  final productId = row['id'] as int;

  return {
    'id': productId,
    'kodeItem': row['kode_item'],
    'namaItem': row['nama_item'],
    // the base unit is the product's own satuan; the picker lists only the derived ones
    'satuan': getBaseProductUnit(db, productId).unitCode,
    'hargaPokok': rupiahJson(row['harga_pokok'] as int),
    'hargaJual': rupiahJson(row['harga_jual'] as int),
    'units': _derivedUnitsJson(db, productId),
  };
}

List<Map<String, Object?>> searchProductsForPurchase(Db db, String q) {
  final rows = q.isEmpty
      ? db.select('SELECT id, kode_item, nama_item, harga_pokok, harga_jual FROM products ORDER BY nama_item LIMIT 20')
      : db.select(
          'SELECT id, kode_item, nama_item, harga_pokok, harga_jual FROM products WHERE kode_item LIKE ? OR nama_item LIKE ? OR barcode LIKE ? ORDER BY nama_item LIMIT 20',
          List.filled(3, '%$q%'),
        );

  return [for (final row in rows) _productOption(db, row)];
}

/// Exact-barcode lookup: an ambiguous scan would silently add the wrong product.
Map<String, Object?>? findProductForPurchaseByBarcode(Db db, String barcode) {
  final trimmed = barcode.trim();

  if (trimmed.isEmpty) {
    return null;
  }

  final row = db.first('SELECT id, kode_item, nama_item, harga_pokok, harga_jual FROM products WHERE barcode = ?', [trimmed]);

  return row == null ? null : _productOption(db, row);
}

// ---------------------------------------------------------------------------
// Supplier debt
// ---------------------------------------------------------------------------

/// Unsettled purchases, oldest first - the order a lump payment is allocated in (cents).
List<Row> _supplierDebts(Db db, [int? supplierId]) {
  return db.select(
    'SELECT pu.id AS purchase_id, pu.supplier_id, s.nama AS supplier_name, pu.tanggal, pu.total, pu.dibayar, pu.total - pu.dibayar AS sisa '
    'FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id '
    'WHERE pu.dibayar < pu.total ${supplierId == null ? '' : 'AND pu.supplier_id = ?'} ORDER BY pu.tanggal, pu.id',
    [?supplierId],
  );
}

List<Map<String, Object?>> listSupplierDebts(Db db, [int? supplierId]) => [
      for (final row in _supplierDebts(db, supplierId))
        {
          'purchaseId': row['purchase_id'],
          'supplierId': row['supplier_id'],
          'supplierName': row['supplier_name'],
          'tanggal': row['tanggal'],
          'total': rupiahJson(row['total'] as int),
          'dibayar': rupiahJson(row['dibayar'] as int),
          'sisa': rupiahJson(row['sisa'] as int),
        },
    ];

/// Shared by recording and correcting an instalment; returns the trimmed note.
String? _assertPaymentFields(int jumlah, String tanggal, String? keterangan) {
  if (jumlah <= 0) {
    throw BusinessException('Jumlah bayar harus lebih dari 0.');
  }

  if (tanggal.trim().isEmpty) {
    throw BusinessException('Tanggal wajib diisi.');
  }

  final note = keterangan?.trim();

  if (note != null && note.length > 500) {
    throw BusinessException('Keterangan maksimal 500 karakter.');
  }

  return note == null || note.isEmpty ? null : note;
}

/// Pays a supplier one lump sum, spread over their outstanding invoices oldest first.
/// Returns how much landed on each invoice (cents).
List<({int purchaseId, int jumlah})> recordSupplierPayment(
  Db db, {
  required int supplierId,
  required int jumlah,
  required String tanggal,
  String? keterangan,
  int? userId,
}) {
  if (db.first('SELECT id FROM suppliers WHERE id = ?', [supplierId]) == null) {
    throw BusinessException('Supplier tidak ditemukan.');
  }

  final note = _assertPaymentFields(jumlah, tanggal, keterangan);
  final debts = _supplierDebts(db, supplierId);
  final totalHutang = debts.fold<int>(0, (sum, debt) => sum + (debt['sisa'] as int));

  if (jumlah > totalHutang) {
    throw BusinessException('Jumlah bayar melebihi sisa hutang supplier.');
  }

  return db.transaction(() {
    final now = nowSeconds();
    final alokasi = <({int purchaseId, int jumlah})>[];
    var sisa = jumlah;

    for (final debt in debts) {
      if (sisa <= 0) {
        break;
      }

      final porsi = _min(sisa, debt['sisa'] as int);
      final purchaseId = debt['purchase_id'] as int;

      db.insert(
        'INSERT INTO purchase_payments (purchase_id, user_id, jumlah, tanggal, keterangan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [purchaseId, userId, porsi, tanggal, note, now, now],
      );
      db.execute('UPDATE purchases SET dibayar = dibayar + ?, updated_at = ? WHERE id = ?', [porsi, now, purchaseId]);

      alokasi.add((purchaseId: purchaseId, jumlah: porsi));
      sisa -= porsi;
    }

    return alokasi;
  });
}

int _min(int a, int b) => a < b ? a : b;

/// One supplier's instalment history, newest first.
List<Map<String, Object?>> listSupplierPayments(Db db, int supplierId, {int limit = 50}) => [
      for (final row in db.select(
        'SELECT pp.id, pp.purchase_id, pp.jumlah, pp.tanggal, pp.keterangan FROM purchase_payments pp '
        'JOIN purchases pu ON pu.id = pp.purchase_id WHERE pu.supplier_id = ? ORDER BY pp.tanggal DESC, pp.id DESC LIMIT ?',
        [supplierId, limit],
      ))
        {
          'id': row['id'],
          'purchaseId': row['purchase_id'],
          'jumlah': rupiahJson(row['jumlah'] as int),
          'tanggal': row['tanggal'],
          'keterangan': row['keterangan'],
        },
    ];

/// Corrects one recorded instalment. It stays on its invoice, whose `dibayar` moves by the
/// difference, so the new amount may not pay the invoice past its total.
void updateSupplierPayment(Db db, int paymentId, {required int jumlah, required String tanggal, String? keterangan}) {
  final payment = db.first('SELECT * FROM purchase_payments WHERE id = ?', [paymentId]);

  if (payment == null) {
    throw BusinessException('Pembayaran tidak ditemukan.');
  }

  final note = _assertPaymentFields(jumlah, tanggal, keterangan);
  final purchase = db.first('SELECT * FROM purchases WHERE id = ?', [payment['purchase_id']]);

  if (purchase == null) {
    throw BusinessException('Pembelian tidak ditemukan.');
  }

  final dibayarTanpaIni = (purchase['dibayar'] as int) - (payment['jumlah'] as int);

  if (jumlah > (purchase['total'] as int) - dibayarTanpaIni) {
    throw BusinessException('Jumlah bayar melebihi sisa hutang faktur.');
  }

  db.transaction(() {
    final now = nowSeconds();

    db.execute('UPDATE purchase_payments SET jumlah = ?, tanggal = ?, keterangan = ?, updated_at = ? WHERE id = ?', [jumlah, tanggal, note, now, paymentId]);
    db.execute('UPDATE purchases SET dibayar = ?, updated_at = ? WHERE id = ?', [dibayarTanpaIni + jumlah, now, purchase['id']]);
  });
}

/// Removes an instalment that was never really paid; its amount goes back onto the debt.
void deleteSupplierPayment(Db db, int paymentId) {
  final payment = db.first('SELECT * FROM purchase_payments WHERE id = ?', [paymentId]);

  if (payment == null) {
    throw BusinessException('Pembayaran tidak ditemukan.');
  }

  db.transaction(() {
    db.execute('UPDATE purchases SET dibayar = dibayar - ?, updated_at = ? WHERE id = ?', [payment['jumlah'], nowSeconds(), payment['purchase_id']]);
    db.execute('DELETE FROM purchase_payments WHERE id = ?', [paymentId]);
  });
}

/// Sets what is still owed on one invoice directly. Instalments are real money and stay,
/// so this rewrites the down payment: the debt ranges from 0 to the total less instalments.
void updatePurchaseSisaHutang(Db db, int purchaseId, int sisa) {
  final purchase = db.first('SELECT * FROM purchases WHERE id = ?', [purchaseId]);

  if (purchase == null) {
    throw BusinessException('Pembelian tidak ditemukan.');
  }

  if (sisa < 0) {
    throw BusinessException('Sisa hutang tidak boleh negatif.');
  }

  if (sisa > (purchase['total'] as int) - _cicilan(db, purchaseId)) {
    throw BusinessException('Sisa hutang tidak boleh melebihi total faktur dikurangi cicilan yang sudah dibayar.');
  }

  db.execute('UPDATE purchases SET dibayar = ?, updated_at = ? WHERE id = ?', [(purchase['total'] as int) - sisa, nowSeconds(), purchaseId]);
}
