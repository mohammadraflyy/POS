/// Stock opname (physical counts) and the stock ledger (Kartu Stok).
library;

import '../core/errors.dart';
import '../core/qty.dart';
import '../db/db.dart';

List<Map<String, Object?>> listCategories(Db db) =>
    [for (final row in db.select('SELECT id, nama FROM categories ORDER BY nama')) {'id': row['id'], 'nama': row['nama']}];

/// Products to count. Browsing whole categories is unlimited; a keyword search is capped
/// at 20. `stockRevision` is the product's newest ledger id, so a save can detect that the
/// shelf moved after it was counted.
List<Map<String, Object?>> searchProductsForOpname(Db db, {String q = '', List<int> categoryIds = const []}) {
  final keyword = q.trim();
  final browsing = keyword.isEmpty && categoryIds.isNotEmpty;
  final conditions = ['p.is_active = 1'];
  final params = <Object?>[];

  if (categoryIds.isNotEmpty) {
    conditions.add('p.category_id IN (${List.filled(categoryIds.length, '?').join(', ')})');
    params.addAll(categoryIds);
  }

  if (keyword.isNotEmpty) {
    conditions.add('(p.kode_item LIKE ? OR p.nama_item LIKE ? OR p.barcode LIKE ? OR c.nama LIKE ?)');
    params.addAll(List.filled(4, '%$keyword%'));
  }

  final rows = db.select(
    'SELECT p.id, p.kode_item, p.barcode, p.nama_item, c.nama AS category_name, u.code AS satuan, p.stok, '
    'coalesce((SELECT max(id) FROM stock_movements WHERE product_id = p.id), 0) AS stock_revision '
    'FROM products p LEFT JOIN categories c ON c.id = p.category_id '
    'LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base_unit = 1 LEFT JOIN units u ON u.id = pu.unit_id '
    'WHERE ${conditions.join(' AND ')} ORDER BY p.nama_item${browsing ? '' : ' LIMIT 20'}',
    params,
  );

  return [
    for (final row in rows)
      {
        'id': row['id'],
        'kodeItem': row['kode_item'],
        'barcode': row['barcode'],
        'namaItem': row['nama_item'],
        'categoryName': row['category_name'],
        'satuan': row['satuan'] ?? '',
        'stok': row['stok'],
        'stockRevision': row['stock_revision'],
      },
  ];
}

String _today() {
  final now = DateTime.now();

  return '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
}

/// Sets a product's stock to what was physically counted, logging the difference. Pass
/// [expectedStock] or [expectedRevision] to refuse the save when the shelf moved since.
int recordStockAdjustment(
  Db db, {
  required int productId,
  required num stokSesudah,
  String? alasan,
  int? userId,
  num? expectedStock,
  int? expectedRevision,
}) {
  if (!isQtyValid(stokSesudah)) {
    throw BusinessException('Stok fisik harus berupa angka, minimal 0.');
  }

  final counted = bulatkanQty(stokSesudah);
  final note = alasan?.trim();
  final cleanNote = note == null || note.isEmpty ? null : note;

  if (cleanNote != null && cleanNote.length > 255) {
    throw BusinessException('Alasan maksimal 255 karakter.');
  }

  return db.transaction(() {
    final product = db.first('SELECT stok FROM products WHERE id = ?', [productId]);

    if (product == null) {
      throw BusinessException('Produk tidak ditemukan.');
    }

    final revision = db.scalar<int>('SELECT coalesce(max(id), 0) FROM stock_movements WHERE product_id = ?', [productId]) ?? 0;
    final stokSebelum = product['stok'] as num;

    if ((expectedStock != null && expectedStock != stokSebelum) || (expectedRevision != null && expectedRevision != revision)) {
      throw BusinessException('Stok berubah sejak penghitungan. Refresh lalu hitung ulang sebelum menyimpan.');
    }

    final selisih = bulatkanQty(counted - stokSebelum);
    final now = nowSeconds();
    final adjustmentId = db.insert(
      'INSERT INTO stock_adjustments (product_id, user_id, stok_sebelum, stok_sesudah, selisih, alasan, tanggal, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [productId, userId, stokSebelum, counted, selisih, cleanNote, _today(), now, now],
    );

    db.execute('UPDATE products SET stok = ?, updated_at = ? WHERE id = ?', [counted, now, productId]);

    // counted in base units, so the base row is the unit to log against
    final baseUnitId = db.scalar<int>('SELECT id FROM product_units WHERE product_id = ? AND is_base_unit = 1', [productId]);

    db.insert(
      "INSERT INTO stock_movements (product_id, product_unit_id, quantity, conversion_factor, base_quantity, movement_type, reference_id, created_at) "
      "VALUES (?, ?, ?, 1, ?, 'stock_adjustment', ?, ?)",
      [productId, baseUnitId, selisih, selisih, adjustmentId, now],
    );

    return adjustmentId;
  });
}

const _defaultPageSize = 25;
const _validPageSizes = [10, 25, 50, 100];
const movementTypes = ['sale', 'sale_cancel', 'purchase', 'stock_adjustment'];

/// Every sale, purchase and opname read back as one history, with the stock level before
/// and after each row computed against the complete ledger.
Map<String, Object?> listStockMovements(
  Db db, {
  String? q,
  String? movementType,
  String? dari,
  String? sampai,
  int page = 1,
  int? pageSize,
}) {
  final size = pageSize != null && _validPageSizes.contains(pageSize) ? pageSize : _defaultPageSize;
  final currentPage = page < 1 ? 1 : page;
  final conditions = <String>[];
  final params = <Object?>[];

  if (q != null && q.isNotEmpty) {
    conditions.add('(p.kode_item LIKE ? OR p.nama_item LIKE ?)');
    params.addAll(['%$q%', '%$q%']);
  }

  if (movementType != null && movementType.isNotEmpty) {
    conditions.add('sm.movement_type = ?');
    params.add(movementType);
  }

  if (dari != null && dari.isNotEmpty) {
    conditions.add('sm.created_at >= ?');
    params.add(toEpochSeconds(DateTime.parse('${dari}T00:00:00')));
  }

  if (sampai != null && sampai.isNotEmpty) {
    conditions.add('sm.created_at <= ?');
    params.add(toEpochSeconds(DateTime.parse('${sampai}T23:59:59')));
  }

  final where = conditions.isEmpty ? '' : 'WHERE ${conditions.join(' AND ')}';
  final total = db.scalar<int>('SELECT count(*) FROM stock_movements sm JOIN products p ON p.id = sm.product_id $where', params) ?? 0;
  final rows = db.select(
    'SELECT sm.id, sm.created_at, sm.product_id, p.kode_item, p.nama_item, u.code AS satuan, sm.quantity, sm.base_quantity, '
    '(SELECT bu.code FROM product_units bpu JOIN units bu ON bu.id = bpu.unit_id WHERE bpu.product_id = p.id AND bpu.is_base_unit = 1 LIMIT 1) AS base_unit, '
    'p.stok - coalesce((SELECT sum(later.base_quantity) FROM stock_movements later WHERE later.product_id = sm.product_id AND later.id > sm.id), 0) AS stock_after, '
    'sm.movement_type, sm.reference_id '
    'FROM stock_movements sm JOIN products p ON p.id = sm.product_id '
    'LEFT JOIN product_units pu ON pu.id = sm.product_unit_id LEFT JOIN units u ON u.id = pu.unit_id '
    '$where ORDER BY sm.created_at DESC, sm.id DESC LIMIT ? OFFSET ?',
    [...params, size, (currentPage - 1) * size],
  );

  return {
    'data': [
      for (final row in rows)
        {
          'id': row['id'],
          'createdAt': fromEpochSeconds(row['created_at'] as int).toIso8601String(),
          'productId': row['product_id'],
          'kodeItem': row['kode_item'],
          'namaItem': row['nama_item'],
          'satuan': row['satuan'],
          'quantity': row['quantity'],
          'baseQuantity': row['base_quantity'],
          'baseUnit': row['base_unit'],
          'stockBefore': bulatkanQty((row['stock_after'] as num) - (row['base_quantity'] as num)),
          'stockAfter': bulatkanQty(row['stock_after'] as num),
          'movementType': row['movement_type'],
          'referenceId': row['reference_id'],
        },
    ],
    'currentPage': currentPage,
    'lastPage': total == 0 ? 1 : (total / size).ceil(),
    'total': total,
  };
}
