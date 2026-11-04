import '../core/errors.dart';
import '../core/money.dart';
import '../db/db.dart';
import 'master_satuan.dart';

class ProductUnitRow {
  ProductUnitRow.fromRow(Row row)
      : id = row['id'] as int,
        productId = row['product_id'] as int,
        unitId = row['unit_id'] as int,
        unitCode = row['unit_code'] as String,
        unitName = row['unit_name'] as String,
        unitSymbol = row['unit_symbol'] as String,
        parentUnitId = row['parent_unit_id'] as int?,
        jumlahKemasan = row['jumlah_kemasan'] as int,
        conversionFactor = row['conversion_factor'] as int,
        hargaJual = row['harga_jual'] as int,
        hargaPokok = row['harga_pokok'] as int,
        isBaseUnit = asBool(row['is_base_unit']),
        isDefaultSalesUnit = asBool(row['is_default_sales_unit']),
        isDefaultPurchaseUnit = asBool(row['is_default_purchase_unit']);

  final int id;
  final int productId;
  final int unitId;
  final String unitCode;
  final String unitName;
  final String unitSymbol;

  /// The smaller unit this one is measured in; null means the base unit.
  final int? parentUnitId;
  final int jumlahKemasan;
  final int conversionFactor;
  final int hargaJual;
  final int hargaPokok;
  final bool isBaseUnit;
  final bool isDefaultSalesUnit;
  final bool isDefaultPurchaseUnit;

  /// Same shape the desktop app's product detail screen reads.
  Map<String, Object?> toJson() => {
        'id': id,
        'unitId': unitId,
        'satuan': unitCode,
        'parentUnitId': parentUnitId,
        'jumlahKemasan': jumlahKemasan,
        'konversi': conversionFactor,
        'hargaJual': rupiahJson(hargaJual),
        'hargaPokok': rupiahJson(hargaPokok),
        'isBaseUnit': isBaseUnit,
      };
}

const _unitRowSelect = '''
SELECT pu.id, pu.product_id, pu.unit_id, u.code AS unit_code, u.name AS unit_name, u.symbol AS unit_symbol,
  pu.parent_unit_id, pu.jumlah_kemasan, pu.conversion_factor, pu.harga_jual, pu.harga_pokok,
  pu.is_base_unit, pu.is_default_sales_unit, pu.is_default_purchase_unit
FROM product_units pu JOIN units u ON u.id = pu.unit_id
''';

List<ProductUnitRow> listProductUnits(Db db, int productId) {
  return [
    for (final row in db.select('$_unitRowSelect WHERE pu.product_id = ? ORDER BY pu.conversion_factor, pu.id', [productId]))
      ProductUnitRow.fromRow(row),
  ];
}

/// Every product's units in one query, keyed by product id - for list screens that
/// would otherwise run [listProductUnits] once per row.
Map<int, List<ProductUnitRow>> listProductUnitsFor(Db db, Iterable<int> productIds) {
  final ids = productIds.toSet().toList();
  final result = <int, List<ProductUnitRow>>{for (final id in ids) id: []};

  if (ids.isEmpty) {
    return result;
  }

  final placeholders = List.filled(ids.length, '?').join(', ');

  for (final row in db.select(
    '$_unitRowSelect WHERE pu.product_id IN ($placeholders) ORDER BY pu.conversion_factor, pu.id',
    ids,
  )) {
    final unit = ProductUnitRow.fromRow(row);
    result[unit.productId]!.add(unit);
  }

  return result;
}

ProductUnitRow getBaseProductUnit(Db db, int productId) {
  final row = db.first('$_unitRowSelect WHERE pu.product_id = ? AND pu.is_base_unit = 1', [productId]);

  if (row == null) {
    throw BusinessException('Produk $productId tidak memiliki satuan dasar.');
  }

  return ProductUnitRow.fromRow(row);
}

/// The base unit's code, or null when the product has no base row yet.
String? getBaseUnitCode(Db db, int productId) {
  return db.scalar<String>(
    'SELECT u.code FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id = ? AND pu.is_base_unit = 1',
    [productId],
  );
}

/// Carries a new base cost across to the units that were never given a cost of their
/// own. A unit still at exactly `old base x conversion` was never priced by hand or by a
/// purchase, so it follows; one that differs was set deliberately and survives. The base
/// row always follows, since it mirrors `products.harga_pokok`.
void syncUnitCostsFromBase(Db db, int productId, int hargaPokokLama, int hargaPokokBaru) {
  db.execute(
    'UPDATE product_units SET harga_pokok = ? * conversion_factor, updated_at = ? '
    'WHERE product_id = ? AND (is_base_unit = 1 OR harga_pokok = ? * conversion_factor)',
    [hargaPokokBaru, nowSeconds(), productId, hargaPokokLama],
  );
}

/// Points a product's base row at the unit named by [satuanText] (creating that unit on
/// first sight) and mirrors [hargaJual] onto it.
void syncBaseProductUnit(Db db, int productId, String satuanText, int hargaJual) {
  final unitId = resolveOrCreateUnit(db, satuanText);
  final now = nowSeconds();
  final baseId = db.scalar<int>('SELECT id FROM product_units WHERE product_id = ? AND is_base_unit = 1', [productId]);

  if (baseId != null) {
    db.execute('UPDATE product_units SET unit_id = ?, harga_jual = ?, updated_at = ? WHERE id = ?', [unitId, hargaJual, now, baseId]);

    return;
  }

  // a product created before base rows existed - heal it
  final hargaPokok = db.scalar<int>('SELECT harga_pokok FROM products WHERE id = ?', [productId]) ?? 0;

  db.insert(
    'INSERT INTO product_units (product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, is_base_unit, created_at, updated_at) '
    'VALUES (?, ?, 1, 1, ?, ?, 1, ?, ?)',
    [productId, unitId, hargaJual, hargaPokok, now, now],
  );
}

/// Every unit measured in [unitRowId], directly or through another unit.
List<ProductUnitRow> _unitsContaining(List<ProductUnitRow> chain, int unitRowId) {
  final found = <ProductUnitRow>[];
  var frontier = {unitRowId};

  while (frontier.isNotEmpty) {
    final fresh = chain
        .where((row) => row.parentUnitId != null && frontier.contains(row.parentUnitId) && !found.any((seen) => seen.id == row.id))
        .toList();

    if (fresh.isEmpty) {
      break;
    }

    found.addAll(fresh);
    frontier = fresh.map((row) => row.id).toSet();
  }

  return found;
}

/// The minimum a row needs for the tree walks.
class UnitTreeNode {
  const UnitTreeNode({required this.id, required this.parentUnitId, required this.isBaseUnit});

  final int id;
  final int? parentUnitId;
  final bool isBaseUnit;
}

/// The chain of smaller units a purchase in [unitRowId] physically delivers, base last.
/// Siblings are excluded: buying a SAK puts pieces on the shelf, but says nothing about
/// what a RENTENG costs.
List<T> unitsInside<T>(List<T> chain, int unitRowId, UnitTreeNode Function(T) node) {
  final inside = <T>[];
  T? current = _firstWhereOrNull(chain, (row) => node(row).id == unitRowId);

  while (current != null) {
    final parentId = node(current).parentUnitId;
    final parent = parentId == null ? null : _firstWhereOrNull(chain, (row) => node(row).id == parentId);

    if (parent == null || inside.any((seen) => node(seen).id == node(parent).id)) {
      break;
    }

    inside.add(parent);
    current = parent;
  }

  final base = _firstWhereOrNull(chain, (row) => node(row).isBaseUnit);

  if (base != null && node(base).id != unitRowId && !inside.any((seen) => node(seen).id == node(base).id)) {
    inside.add(base);
  }

  return inside;
}

T? _firstWhereOrNull<T>(Iterable<T> items, bool Function(T) test) {
  for (final item in items) {
    if (test(item)) {
      return item;
    }
  }

  return null;
}

/// Sentinel for "the caller did not say" on optional nullable parameters, where null
/// itself is a meaningful answer (a parent of null means the base unit).
const unset = Object();

({int? parentUnitId, int conversion}) _resolveParentConversion(
  List<ProductUnitRow> chain,
  Object? parentUnitId,
  int fallbackConversion, {
  int? selfId,
}) {
  if (identical(parentUnitId, unset)) {
    return (parentUnitId: null, conversion: fallbackConversion);
  }

  if (parentUnitId == null) {
    return (parentUnitId: null, conversion: 1);
  }

  final parent = _firstWhereOrNull(chain, (row) => row.id == parentUnitId);

  if (parent == null) {
    throw BusinessException('Satuan acuan tidak ditemukan pada produk ini.');
  }

  if (parent.isBaseUnit) {
    // the base row is the implicit root; pointing at it explicitly is the same as null
    return (parentUnitId: null, conversion: 1);
  }

  if (selfId != null) {
    if (parent.id == selfId) {
      throw BusinessException('Satuan tidak bisa mengacu ke dirinya sendiri.');
    }

    if (_unitsContaining(chain, selfId).any((row) => row.id == parent.id)) {
      throw BusinessException('Satuan acuan tidak boleh satuan yang justru berisi satuan ini.');
    }
  }

  return (parentUnitId: parent.id, conversion: parent.conversionFactor);
}

void _validateUnitInput(int jumlahKemasan, int hargaJual, int? hargaPokok) {
  if (jumlahKemasan < 1) {
    throw BusinessException('Jumlah kemasan minimal 1.');
  }

  if (hargaJual < 0) {
    throw BusinessException('Harga jual wajib diisi dan tidak boleh negatif.');
  }

  if (hargaPokok != null && hargaPokok < 0) {
    throw BusinessException('Harga beli tidak boleh negatif.');
  }
}

/// [parentUnitId] left as [unset] stacks the new unit on the largest one that exists.
int addProductUnit(
  Db db,
  int productId, {
  required int unitId,
  required int jumlahKemasan,
  required int hargaJual,
  int? hargaPokok,
  Object? parentUnitId = unset,
}) {
  _validateUnitInput(jumlahKemasan, hargaJual, hargaPokok);

  final unit = db.first('SELECT id, is_active FROM units WHERE id = ?', [unitId]);

  if (unit == null || !asBool(unit['is_active'])) {
    throw BusinessException('Satuan tidak ditemukan atau tidak aktif.');
  }

  final chain = listProductUnits(db, productId);

  if (chain.any((u) => u.unitId == unitId)) {
    throw BusinessException('Satuan ini sudah dipakai untuk produk ini.');
  }

  final derived = chain.where((u) => !u.isBaseUnit).toList();
  final largestConversion = derived.isNotEmpty ? derived.last.conversionFactor : 1;
  final largestId = derived.isNotEmpty ? derived.last.id : null;
  final parent = identical(parentUnitId, unset)
      ? (parentUnitId: largestId, conversion: largestConversion)
      : _resolveParentConversion(chain, parentUnitId, largestConversion);
  final conversionFactor = jumlahKemasan * parent.conversion;
  final baseCost = db.scalar<int>('SELECT harga_pokok FROM products WHERE id = ?', [productId]) ?? 0;
  final now = nowSeconds();

  return db.insert(
    'INSERT INTO product_units (product_id, unit_id, parent_unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, '
    'is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)',
    [productId, unitId, parent.parentUnitId, jumlahKemasan, conversionFactor, hargaJual, hargaPokok ?? baseCost * conversionFactor, now, now],
  );
}

/// [parentUnitId] left as [unset] keeps the unit where it hangs; null moves it onto the base.
void updateProductUnit(
  Db db,
  int productId,
  int unitRowId, {
  required int unitId,
  required int jumlahKemasan,
  required int hargaJual,
  int? hargaPokok,
  Object? parentUnitId = unset,
}) {
  final chain = listProductUnits(db, productId);
  final target = _firstWhereOrNull(chain, (u) => u.id == unitRowId);

  if (target == null) {
    throw BusinessException('Satuan tidak ditemukan.');
  }

  final now = nowSeconds();

  if (target.isBaseUnit) {
    // the base unit's identity and conversion are fixed - only hargaJual can change, and
    // it stays mirrored onto products.harga_jual
    if (hargaJual < 0) {
      throw BusinessException('Harga jual wajib diisi dan tidak boleh negatif.');
    }

    db.transaction(() {
      db.execute('UPDATE product_units SET harga_jual = ?, updated_at = ? WHERE id = ?', [hargaJual, now, unitRowId]);
      db.execute('UPDATE products SET harga_jual = ?, updated_at = ? WHERE id = ?', [hargaJual, now, productId]);
    });

    return;
  }

  _validateUnitInput(jumlahKemasan, hargaJual, hargaPokok);

  if (chain.any((u) => u.id != unitRowId && u.unitId == unitId)) {
    throw BusinessException('Satuan ini sudah dipakai untuk produk ini.');
  }

  final parent = _resolveParentConversion(
    chain,
    identical(parentUnitId, unset) ? target.parentUnitId : parentUnitId,
    1,
    selfId: unitRowId,
  );
  final conversionFactor = jumlahKemasan * parent.conversion;

  db.transaction(() {
    // Only the edited row's cost is restated: its containers are still the same physical
    // package, so what the owner paid for one of them does not change here.
    db.execute(
      'UPDATE product_units SET unit_id = ?, parent_unit_id = ?, jumlah_kemasan = ?, conversion_factor = ?, harga_jual = ?, '
      'harga_pokok = ?, updated_at = ? WHERE id = ?',
      [unitId, parent.parentUnitId, jumlahKemasan, conversionFactor, hargaJual, hargaPokok ?? target.hargaPokok, now, unitRowId],
    );

    // Resizing a unit changes how many base units every container of it holds; the walk
    // goes outward level by level, so a parent is rewritten before its children read it.
    final conversionById = <int, int>{unitRowId: conversionFactor};

    for (final row in _unitsContaining(chain, unitRowId)) {
      final parentConversion = row.parentUnitId == null
          ? 1
          : conversionById[row.parentUnitId] ?? _firstWhereOrNull(chain, (c) => c.id == row.parentUnitId)?.conversionFactor ?? 1;
      final rowConversion = row.jumlahKemasan * parentConversion;
      conversionById[row.id] = rowConversion;

      db.execute('UPDATE product_units SET conversion_factor = ?, updated_at = ? WHERE id = ?', [rowConversion, now, row.id]);
    }
  });
}

void deleteProductUnit(Db db, int productId, int unitRowId) {
  final chain = listProductUnits(db, productId);
  final target = _firstWhereOrNull(chain, (u) => u.id == unitRowId);

  if (target == null) {
    return;
  }

  if (target.isBaseUnit) {
    throw BusinessException('Satuan dasar tidak bisa dihapus.');
  }

  // whatever is measured in this unit loses its yardstick, so it goes with it
  final ids = [unitRowId, ..._unitsContaining(chain, unitRowId).map((row) => row.id)];
  db.execute('DELETE FROM product_units WHERE id IN (${List.filled(ids.length, '?').join(', ')})', ids);
}

class PriceTierRow {
  PriceTierRow.fromRow(Row row)
      : id = row['id'] as int,
        productId = row['product_id'] as int,
        productUnitId = row['product_unit_id'] as int,
        minQty = row['min_qty'] as int,
        maxQty = row['max_qty'] as int?,
        hargaJual = row['harga_jual'] as int;

  final int id;
  final int productId;
  final int productUnitId;
  final int minQty;

  /// Null means the range runs open-ended above [minQty].
  final int? maxQty;
  final int hargaJual;

  Map<String, Object?> toJson() =>
      {'id': id, 'productUnitId': productUnitId, 'minQty': minQty, 'maxQty': maxQty, 'hargaJual': rupiahJson(hargaJual)};
}

/// Closed [min, max] ranges, with a null max reading as unbounded above.
bool _rangesOverlap(int aMin, int? aMax, int bMin, int? bMax) => aMin <= (bMax ?? 1 << 62) && bMin <= (aMax ?? 1 << 62);

int addPriceTier(Db db, int productId, int productUnitId, {required int minQty, int? maxQty, required int hargaJual}) {
  if (minQty <= 0) {
    throw BusinessException('Qty minimal harus lebih dari 0.');
  }

  if (maxQty != null && maxQty < minQty) {
    throw BusinessException('Qty maksimal harus lebih besar atau sama dengan qty minimal.');
  }

  if (hargaJual < 0) {
    throw BusinessException('Harga jual tidak boleh negatif.');
  }

  if (db.first('SELECT id FROM product_units WHERE id = ? AND product_id = ?', [productUnitId, productId]) == null) {
    throw BusinessException('Satuan tidak ditemukan.');
  }

  // Overlap is checked per unit, not per product: 1-10 PCS and 1-10 DUS are different
  // prices for different things, so both are legal side by side.
  final existing = db.select('SELECT min_qty, max_qty FROM product_price_tiers WHERE product_unit_id = ?', [productUnitId]);

  if (existing.any((tier) => _rangesOverlap(minQty, maxQty, tier['min_qty'] as int, tier['max_qty'] as int?))) {
    throw BusinessException('Rentang qty tumpang tindih dengan tier yang sudah ada.');
  }

  final now = nowSeconds();

  return db.insert(
    'INSERT INTO product_price_tiers (product_id, product_unit_id, min_qty, max_qty, harga_jual, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [productId, productUnitId, minQty, maxQty, hargaJual, now, now],
  );
}

void deletePriceTier(Db db, int productId, int tierId) {
  if (db.first('SELECT id FROM product_price_tiers WHERE id = ? AND product_id = ?', [tierId, productId]) == null) {
    throw BusinessException('Harga bertingkat tidak ditemukan.');
  }

  db.execute('DELETE FROM product_price_tiers WHERE id = ?', [tierId]);
}

/// Omit [productUnitId] to get every unit's tiers.
List<PriceTierRow> listPriceTiers(Db db, int productId, [int? productUnitId]) {
  final rows = productUnitId == null
      ? db.select('SELECT * FROM product_price_tiers WHERE product_id = ? ORDER BY product_unit_id, min_qty', [productId])
      : db.select(
          'SELECT * FROM product_price_tiers WHERE product_id = ? AND product_unit_id = ? ORDER BY product_unit_id, min_qty',
          [productId, productUnitId],
        );

  return [for (final row in rows) PriceTierRow.fromRow(row)];
}

List<Map<String, Object?>> listPriceHistory(Db db, int productId) {
  return [
    for (final row in db.select(
      'SELECT h.*, u.name AS user_name FROM product_price_histories h LEFT JOIN users u ON u.id = h.user_id '
      'WHERE h.product_id = ? ORDER BY h.created_at DESC, h.id DESC',
      [productId],
    ))
      {
        'id': row['id'],
        'hargaPokokLama': rupiahJson(row['harga_pokok_lama'] as int),
        'hargaPokokBaru': rupiahJson(row['harga_pokok_baru'] as int),
        'hargaJualLama': rupiahJson(row['harga_jual_lama'] as int),
        'hargaJualBaru': rupiahJson(row['harga_jual_baru'] as int),
        'createdAt': fromEpochSeconds(row['created_at'] as int).toIso8601String(),
        'userName': row['user_name'],
      },
  ];
}

Map<String, Object?> getProductDetail(Db db, int productId) {
  final product = db.first('SELECT nama_item, kode_item FROM products WHERE id = ?', [productId]);

  if (product == null) {
    throw BusinessException('Produk tidak ditemukan.');
  }

  return {
    'namaItem': product['nama_item'],
    'kodeItem': product['kode_item'],
    'units': [for (final unit in listProductUnits(db, productId)) unit.toJson()],
    'priceTiers': [for (final tier in listPriceTiers(db, productId)) tier.toJson()],
    'priceHistory': listPriceHistory(db, productId),
  };
}
