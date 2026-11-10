import 'package:sqlite3/sqlite3.dart' show SqliteException;

import '../core/errors.dart';
import '../core/money.dart';
import '../core/qty.dart';
import '../core/spreadsheet.dart';
import '../db/db.dart';
import 'inventory_units.dart';
import 'master_satuan.dart';

const _defaultPageSize = 25;
const _validPageSizes = [10, 25, 50, 100];

const _productListSelect = '''
SELECT p.id, p.kode_item, p.barcode, p.nama_item, c.nama AS category_name, u.code AS satuan,
  p.harga_pokok, p.harga_jual, p.stok, p.is_active,
  (SELECT COUNT(*) FROM product_units x WHERE x.product_id = p.id AND x.is_base_unit = 0) AS units_count,
  (SELECT COUNT(*) FROM product_price_tiers t WHERE t.product_id = p.id) AS price_tiers_count
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base_unit = 1
LEFT JOIN units u ON u.id = pu.unit_id
''';

/// The shape every product list in the app reads (rupiah).
Map<String, Object?> productListItemJson(Row row) => {
      'id': row['id'],
      'kodeItem': row['kode_item'],
      'barcode': row['barcode'],
      'namaItem': row['nama_item'],
      'categoryName': row['category_name'],
      'satuan': row['satuan'] ?? '',
      'hargaPokok': rupiahJson(row['harga_pokok'] as int),
      'hargaJual': rupiahJson(row['harga_jual'] as int),
      'stok': row['stok'],
      'isActive': asBool(row['is_active']),
      'unitsCount': row['units_count'],
      'priceTiersCount': row['price_tiers_count'],
    };

String _likeClause() => '(p.kode_item LIKE ? OR p.nama_item LIKE ? OR p.barcode LIKE ?)';

List<Object?> _likeParams(String search) => List.filled(3, '%$search%');

Map<String, Object?> listProducts(Db db, {String? search, int page = 1, int? pageSize, String? stockFilter}) {
  final size = pageSize != null && _validPageSizes.contains(pageSize) ? pageSize : _defaultPageSize;
  final currentPage = page < 1 ? 1 : page;
  final hasSearch = search != null && search.isNotEmpty;
  final clauses = <String>[];
  if (hasSearch) clauses.add(_likeClause());
  if (stockFilter == 'out') {
    clauses.add('p.stok <= 0');
  } else if (stockFilter == 'low') {
    clauses.add('p.stok > 0 AND p.stok <= 5000');
  } else if (stockFilter == 'warning') {
    clauses.add('p.stok <= 5000');
  }
  final where = clauses.isEmpty ? '' : 'WHERE ${clauses.join(' AND ')}';
  final params = hasSearch ? _likeParams(search) : <Object?>[];
  final total = db.scalar<int>('SELECT count(*) FROM products p $where', params) ?? 0;
  final rows = db.select('$_productListSelect $where ORDER BY p.nama_item LIMIT ? OFFSET ?', [...params, size, (currentPage - 1) * size]);

  return {
    'data': rows.map(productListItemJson).toList(),
    'currentPage': currentPage,
    'lastPage': total == 0 ? 1 : (total / size).ceil(),
    'total': total,
  };
}

int? _resolveCategoryId(Db db, String? kategori) {
  final name = kategori?.trim();

  if (name == null || name.isEmpty) {
    return null;
  }

  final existing = db.scalar<int>('SELECT id FROM categories WHERE nama = ?', [name]);

  if (existing != null) {
    return existing;
  }

  final now = nowSeconds();

  return db.insert('INSERT INTO categories (nama, created_at, updated_at) VALUES (?, ?, ?)', [name, now, now]);
}

class ProductInput {
  const ProductInput({
    required this.kodeItem,
    required this.barcode,
    required this.namaItem,
    required this.kategori,
    required this.satuan,
    required this.hargaPokok,
    required this.hargaJual,
    this.isActive = true,
  });

  final String kodeItem;
  final String? barcode;
  final String namaItem;
  final String? kategori;
  final String satuan;

  /// cents
  final int hargaPokok;

  /// cents
  final int hargaJual;
  final bool isActive;
}

void updateProduct(Db db, int id, ProductInput input, {int? userId}) {
  if (input.kodeItem.trim().isEmpty) {
    throw BusinessException('Kode item wajib diisi.');
  }

  if (input.kodeItem.length > 50) {
    throw BusinessException('Kode item maksimal 50 karakter.');
  }

  if (db.first('SELECT id FROM products WHERE kode_item = ? AND id != ?', [input.kodeItem, id]) != null) {
    throw BusinessException('Kode item sudah digunakan.');
  }

  final barcode = input.barcode;

  if (barcode != null && barcode.length > 100) {
    throw BusinessException('Barcode maksimal 100 karakter.');
  }

  if (barcode != null && barcode.isNotEmpty && db.first('SELECT id FROM products WHERE barcode = ? AND id != ?', [barcode, id]) != null) {
    throw BusinessException('Barcode sudah digunakan.');
  }

  if (input.namaItem.trim().isEmpty) {
    throw BusinessException('Nama item wajib diisi.');
  }

  if (input.namaItem.length > 255) {
    throw BusinessException('Nama item maksimal 255 karakter.');
  }

  if (input.satuan.trim().isEmpty) {
    throw BusinessException('Satuan wajib diisi.');
  }

  if (input.satuan.length > 20) {
    throw BusinessException('Satuan maksimal 20 karakter.');
  }

  if (input.hargaPokok < 0) {
    throw BusinessException('Harga pokok tidak boleh negatif.');
  }

  if (input.hargaJual < 0) {
    throw BusinessException('Harga jual tidak boleh negatif.');
  }

  if ((input.kategori?.trim().length ?? 0) > 255) {
    throw BusinessException('Kategori maksimal 255 karakter.');
  }

  final existing = db.first('SELECT harga_pokok, harga_jual FROM products WHERE id = ?', [id]);

  if (existing == null) {
    throw BusinessException('Produk tidak ditemukan.');
  }

  db.transaction(() {
    final categoryId = _resolveCategoryId(db, input.kategori);
    final now = nowSeconds();

    db.execute(
      'UPDATE products SET kode_item = ?, barcode = ?, nama_item = ?, category_id = ?, harga_pokok = ?, harga_jual = ?, is_active = ?, updated_at = ? WHERE id = ?',
      [input.kodeItem, _blankToNull(barcode), input.namaItem, categoryId, input.hargaPokok, input.hargaJual, input.isActive ? 1 : 0, now, id],
    );

    // satuan and hargaJual live on the base product_units row, with products.harga_jual
    // kept as a cache of it, so the two writes stay in step
    syncBaseProductUnit(db, id, input.satuan, input.hargaJual);
    syncUnitCostsFromBase(db, id, existing['harga_pokok'] as int, input.hargaPokok);

    if (existing['harga_pokok'] != input.hargaPokok || existing['harga_jual'] != input.hargaJual) {
      _recordPriceHistory(db, id, userId, existing['harga_pokok'] as int, input.hargaPokok, existing['harga_jual'] as int, input.hargaJual);
    }
  });
}

String? _blankToNull(String? value) => value == null || value.trim().isEmpty ? null : value;

void _recordPriceHistory(Db db, int productId, int? userId, int pokokLama, int pokokBaru, int jualLama, int jualBaru) {
  final now = nowSeconds();

  db.insert(
    'INSERT INTO product_price_histories (product_id, user_id, harga_pokok_lama, harga_pokok_baru, harga_jual_lama, harga_jual_baru, created_at, updated_at) '
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [productId, userId, pokokLama, pokokBaru, jualLama, jualBaru, now, now],
  );
}

bool _isForeignKeyFailure(Object error) => error is SqliteException && error.message.contains('FOREIGN KEY constraint failed');

void deleteProduct(Db db, int id) {
  try {
    db.execute('DELETE FROM products WHERE id = ?', [id]);
  } on SqliteException catch (error) {
    if (_isForeignKeyFailure(error)) {
      throw BusinessException('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.');
    }

    rethrow;
  }
}

Map<String, Object?> bulkDeleteProducts(Db db, List<int> ids) {
  var deleted = 0;
  final blocked = <String>[];

  for (final id in ids) {
    final name = db.scalar<String>('SELECT nama_item FROM products WHERE id = ?', [id]);

    try {
      db.execute('DELETE FROM products WHERE id = ?', [id]);
      deleted++;
    } on SqliteException catch (error) {
      if (!_isForeignKeyFailure(error)) {
        rethrow;
      }

      blocked.add(name ?? 'Produk #$id');
    }
  }

  return {'deleted': deleted, 'blocked': blocked};
}

List<Map<String, Object?>> searchProductsQuick(Db db, String q) {
  final rows = q.isEmpty
      ? db.select('$_productListSelect ORDER BY p.nama_item LIMIT 20')
      : db.select('$_productListSelect WHERE ${_likeClause()} ORDER BY p.nama_item LIMIT 20', _likeParams(q));

  return rows.map(productListItemJson).toList();
}

/// Exact-barcode lookup for a hardware scanner. Deliberately `=` and not `LIKE`: a scan
/// that matched two products would add the wrong one with no human in the loop.
Map<String, Object?>? findProductByBarcode(Db db, String barcode) {
  final trimmed = barcode.trim();

  if (trimmed.isEmpty) {
    return null;
  }

  final row = db.first('$_productListSelect WHERE p.barcode = ?', [trimmed]);

  return row == null ? null : productListItemJson(row);
}

List<Map<String, Object?>> getProductsByIds(Db db, List<int> ids) {
  if (ids.isEmpty) {
    return [];
  }

  final rows = db.select('$_productListSelect WHERE p.id IN (${List.filled(ids.length, '?').join(', ')}) ORDER BY p.nama_item', ids);

  return [
    for (final row in rows) {...productListItemJson(row)}..remove('isActive'),
  ];
}

// ---------------------------------------------------------------------------
// Bulk save (mass input) and imports
// ---------------------------------------------------------------------------

class BulkSaveRow {
  const BulkSaveRow({
    required this.key,
    required this.id,
    required this.kodeItem,
    required this.barcode,
    required this.namaItem,
    required this.kategori,
    required this.satuan,
    required this.hargaPokok,
    required this.hargaJual,
    required this.stok,
  });

  final String key;
  final int? id;
  final String kodeItem;
  final String? barcode;
  final String namaItem;
  final String? kategori;
  final String satuan;

  /// cents
  final int hargaPokok;

  /// cents
  final int hargaJual;
  final num stok;
}

Map<String, Map<String, String>> validateBulkRows(Db db, List<BulkSaveRow> rows) {
  final errors = <String, Map<String, String>>{};

  void addError(String key, String field, String message) {
    (errors[key] ??= {})[field] = message;
  }

  for (final row in rows) {
    if (row.kodeItem.trim().isEmpty) {
      addError(row.key, 'kodeItem', 'Kode item wajib diisi.');
    } else if (row.kodeItem.length > 50) {
      addError(row.key, 'kodeItem', 'Kode item maksimal 50 karakter.');
    }

    if (row.namaItem.trim().isEmpty) {
      addError(row.key, 'namaItem', 'Nama item wajib diisi.');
    } else if (row.namaItem.length > 255) {
      addError(row.key, 'namaItem', 'Nama item maksimal 255 karakter.');
    }

    if (row.satuan.trim().isEmpty) {
      addError(row.key, 'satuan', 'Satuan wajib diisi.');
    } else if (row.satuan.length > 20) {
      addError(row.key, 'satuan', 'Satuan maksimal 20 karakter.');
    }

    if ((row.barcode?.length ?? 0) > 100) {
      addError(row.key, 'barcode', 'Barcode maksimal 100 karakter.');
    }

    if ((row.kategori?.length ?? 0) > 255) {
      addError(row.key, 'kategori', 'Kategori maksimal 255 karakter.');
    }

    if (row.hargaPokok < 0) {
      addError(row.key, 'hargaPokok', 'Harga pokok tidak boleh negatif.');
    }

    if (row.hargaJual < 0) {
      addError(row.key, 'hargaJual', 'Harga jual tidak boleh negatif.');
    }

    if (!isQtyValid(row.stok)) {
      addError(row.key, 'stok', 'Stok harus berupa angka dan tidak boleh negatif.');
    }
  }

  void flagDuplicates(String field, String? Function(BulkSaveRow) value, String message) {
    final byValue = <String, List<String>>{};

    for (final row in rows) {
      final v = value(row)?.trim();

      if (v != null && v.isNotEmpty) {
        (byValue[v] ??= []).add(row.key);
      }
    }

    for (final keys in byValue.values.where((keys) => keys.length > 1)) {
      for (final key in keys) {
        addError(key, field, message);
      }
    }
  }

  flagDuplicates('kodeItem', (row) => row.kodeItem, 'Kode item duplikat pada baris ini.');
  flagDuplicates('barcode', (row) => row.barcode, 'Barcode duplikat pada baris ini.');

  for (final row in rows) {
    final kode = row.kodeItem.trim();

    if (kode.isNotEmpty && errors[row.key]?['kodeItem'] == null && _collides(db, 'kode_item', kode, row.id)) {
      addError(row.key, 'kodeItem', 'Kode item sudah digunakan.');
    }

    final barcode = row.barcode?.trim();

    if (barcode != null && barcode.isNotEmpty && errors[row.key]?['barcode'] == null && _collides(db, 'barcode', barcode, row.id)) {
      addError(row.key, 'barcode', 'Barcode sudah digunakan.');
    }
  }

  return errors;
}

bool _collides(Db db, String column, String value, int? excludeId) {
  return excludeId == null
      ? db.first('SELECT id FROM products WHERE $column = ?', [value]) != null
      : db.first('SELECT id FROM products WHERE $column = ? AND id != ?', [value, excludeId]) != null;
}

String _todayIso() => DateTime.now().toIso8601String().substring(0, 10);

void _recordStockAdjustment(Db db, int productId, int? userId, num sebelum, num sesudah, String alasan) {
  final now = nowSeconds();
  final selisih = bulatkanQty(sesudah - sebelum);
  final adjustmentId = db.insert(
    'INSERT INTO stock_adjustments (product_id, user_id, stok_sebelum, stok_sesudah, selisih, alasan, tanggal, created_at, updated_at) '
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [productId, userId, sebelum, sesudah, selisih, alasan, _todayIso(), now, now],
  );

  db.insert(
    "INSERT INTO stock_movements (product_id, product_unit_id, quantity, conversion_factor, base_quantity, movement_type, reference_id, created_at) "
    "VALUES (?, NULL, ?, 1, ?, 'stock_adjustment', ?, ?)",
    [productId, selisih, selisih, adjustmentId, now],
  );
}

({int created, int updated, int unchanged}) saveProductRows(Db db, List<BulkSaveRow> rows, {required bool updateStok, int? userId}) {
  var created = 0;
  var updated = 0;
  var unchanged = 0;

  for (final row in rows) {
    // stock may be fractional (5,5 KG) - pin it to 3 decimals before it is compared or stored
    final stok = bulatkanQty(row.stok);
    final categoryId = _resolveCategoryId(db, row.kategori);
    final now = nowSeconds();

    if (row.id != null) {
      final existing = db.first('SELECT * FROM products WHERE id = ?', [row.id]);

      if (existing == null) {
        continue;
      }

      final changed = existing['kode_item'] != row.kodeItem ||
          existing['barcode'] != row.barcode ||
          existing['nama_item'] != row.namaItem ||
          existing['category_id'] != categoryId ||
          // satuan lives on the base unit row, compared by normalized code so a
          // case-only difference is not counted as a change
          getBaseUnitCode(db, row.id!) != row.satuan.trim().toUpperCase() ||
          existing['harga_pokok'] != row.hargaPokok ||
          existing['harga_jual'] != row.hargaJual ||
          (updateStok && existing['stok'] != stok);

      if (!changed) {
        unchanged++;
        continue;
      }

      db.execute(
        'UPDATE products SET kode_item = ?, barcode = ?, nama_item = ?, category_id = ?, harga_pokok = ?, harga_jual = ?, updated_at = ?'
        '${updateStok ? ', stok = ?' : ''} WHERE id = ?',
        [row.kodeItem, row.barcode, row.namaItem, categoryId, row.hargaPokok, row.hargaJual, now, if (updateStok) stok, row.id],
      );

      syncBaseProductUnit(db, row.id!, row.satuan, row.hargaJual);
      syncUnitCostsFromBase(db, row.id!, existing['harga_pokok'] as int, row.hargaPokok);
      updated++;

      if (existing['harga_pokok'] != row.hargaPokok || existing['harga_jual'] != row.hargaJual) {
        _recordPriceHistory(db, row.id!, userId, existing['harga_pokok'] as int, row.hargaPokok, existing['harga_jual'] as int, row.hargaJual);
      }

      if (updateStok && existing['stok'] != stok) {
        _recordStockAdjustment(db, row.id!, userId, existing['stok'] as num, stok, 'Import Excel');
      }
    } else {
      final productId = db.insert(
        'INSERT INTO products (kode_item, barcode, nama_item, category_id, harga_pokok, harga_jual, stok, is_active, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        [row.kodeItem, row.barcode, row.namaItem, categoryId, row.hargaPokok, row.hargaJual, stok, now, now],
      );

      // a product is not usable without its base unit row - checkout, purchase and every
      // report resolve their satuan through it
      syncBaseProductUnit(db, productId, row.satuan, row.hargaJual);

      if (stok != 0) {
        _recordStockAdjustment(db, productId, userId, 0, stok, 'Stok awal');
      }

      created++;
    }
  }

  return (created: created, updated: updated, unchanged: unchanged);
}

/// Saves the mass-input grid. Either every row is valid and all are saved, or nothing is
/// and the per-row errors come back for the grid to show.
Map<String, Object?> bulkSaveProducts(Db db, List<BulkSaveRow> rows, {int? userId}) {
  final rowErrors = validateBulkRows(db, rows);

  if (rowErrors.isNotEmpty) {
    return {'success': false, 'rowErrors': rowErrors};
  }

  final result = db.transaction(() => saveProductRows(db, rows, updateStok: false, userId: userId));

  return {'success': true, 'created': result.created, 'updated': result.updated, 'unchanged': result.unchanged};
}

String _cell(List<Object?> row, int? index) {
  if (index == null || index >= row.length) {
    return '';
  }

  final value = row[index];

  if (value is double && value == value.truncateToDouble()) {
    return value.toInt().toString();
  }

  return (value ?? '').toString().trim();
}

/// Numbers from a sheet: a real number cell as-is, text with thousands commas or spaces
/// stripped. A blank cell reads as 0; anything unreadable as null.
num? parseImportNumber(Object? value) {
  if (value is num) {
    return value.isFinite ? value : null;
  }

  final clean = (value ?? '').toString().replaceAll(RegExp(r'[, ]'), '');

  if (clean.isEmpty) {
    return 0;
  }

  return num.tryParse(clean);
}

/// Finds the header row: the first row naming every required column.
({Map<String, int> columns, int headerIndex})? _findHeader(SheetRows rows, Map<String, List<String>> labels, List<String> required) {
  for (var i = 0; i < rows.length; i++) {
    final found = <String, int>{};

    for (var index = 0; index < rows[i].length; index++) {
      final text = (rows[i][index] ?? '').toString().trim().toLowerCase();

      if (text.isEmpty) {
        continue;
      }

      for (final entry in labels.entries) {
        if (!found.containsKey(entry.key) && entry.value.contains(text)) {
          found[entry.key] = index;
        }
      }
    }

    if (required.every(found.containsKey)) {
      return (columns: found, headerIndex: i);
    }
  }

  return null;
}

const _importColumnLabels = {
  'kodeItem': ['kode item'],
  'barcode': ['kode barcode', 'barcode'],
  'namaItem': ['nama item'],
  'kategori': ['jenis', 'kategori'],
  'satuan': ['satuan'],
  'hargaPokok': ['harga beli', 'harga pokok'],
  'hargaJual': ['harga jual'],
  'stok': ['stok'],
};

Map<String, int> importProducts(Db db, SheetRows sheetRows, {int? userId}) {
  final header = _findHeader(sheetRows, _importColumnLabels, ['kodeItem', 'namaItem', 'satuan', 'hargaPokok', 'hargaJual']);

  if (header == null) {
    return {'created': 0, 'updated': 0, 'unchanged': 0, 'skipped': 0};
  }

  final c = header.columns;
  final existingByKode = {
    for (final row in db.select('SELECT id, kode_item FROM products')) row['kode_item'] as String: row['id'] as int,
  };
  final rows = <BulkSaveRow>[];
  final seen = <String>{};
  var skipped = 0;

  for (final sheetRow in sheetRows.skip(header.headerIndex + 1)) {
    final kodeItem = _cell(sheetRow, c['kodeItem']);

    if (kodeItem.isEmpty) {
      continue;
    }

    if (seen.contains(kodeItem)) {
      skipped++;
      continue;
    }

    final namaItem = _cell(sheetRow, c['namaItem']);
    final satuan = _cell(sheetRow, c['satuan']);

    if (namaItem.isEmpty || satuan.isEmpty) {
      skipped++;
      continue;
    }

    final hargaPokok = parseImportNumber(_rawCell(sheetRow, c['hargaPokok']));
    final hargaJual = parseImportNumber(_rawCell(sheetRow, c['hargaJual']));
    final stok = c['stok'] != null ? bulatkanQty(parseImportNumber(_rawCell(sheetRow, c['stok'])) ?? 0) : 0;

    if (hargaPokok == null ||
        hargaJual == null ||
        hargaPokok < 0 ||
        hargaJual < 0 ||
        stok < 0 ||
        namaItem.length > 255 ||
        satuan.length > 20 ||
        kodeItem.length > 50) {
      skipped++;
      continue;
    }

    seen.add(kodeItem);

    final barcode = _cell(sheetRow, c['barcode']);
    final kategori = _cell(sheetRow, c['kategori']);

    rows.add(BulkSaveRow(
      key: 'import-$kodeItem',
      id: existingByKode[kodeItem],
      kodeItem: kodeItem,
      barcode: barcode.isEmpty ? null : barcode,
      namaItem: namaItem,
      kategori: kategori.isEmpty ? null : kategori,
      satuan: satuan,
      hargaPokok: toCents(hargaPokok),
      hargaJual: toCents(hargaJual),
      stok: stok,
    ));
  }

  var created = 0;
  var updated = 0;
  var unchanged = 0;

  db.transaction(() {
    for (final row in rows) {
      try {
        final result = db.transaction(() => saveProductRows(db, [row], updateStok: true, userId: userId));
        created += result.created;
        updated += result.updated;
        unchanged += result.unchanged;
      } on Object {
        skipped++;
      }
    }
  });

  return {'created': created, 'updated': updated, 'unchanged': unchanged, 'skipped': skipped};
}

Object? _rawCell(List<Object?> row, int? index) => index == null || index >= row.length ? null : row[index];

const _importSatuanLabels = {
  'kodeItem': ['kode item'],
  'satuan': ['satuan'],
  'jumlahKemasan': ['qty/paket', 'qty per paket'],
  'hargaJual': ['harga jual'],
};

/// Reads a legacy POS "DAFTAR ITEM" export: one row per satuan tier, each naming which
/// other satuan its quantity is relative to via the unlabeled column right after
/// "Qty/Paket". Never creates products - only fills in derived units of existing ones.
Map<String, int> importSatuan(Db db, SheetRows sheetRows) {
  final result = {
    'produkDiperbarui': 0,
    'satuanDitambahkan': 0,
    'dilewatiTidakDitemukan': 0,
    'dilewatiSatuanTidakCocok': 0,
    'dilewatiRantaiTidakValid': 0,
  };
  final header = _findHeader(sheetRows, _importSatuanLabels, ['kodeItem', 'satuan', 'jumlahKemasan', 'hargaJual']);

  if (header == null) {
    return result;
  }

  final c = header.columns;
  final relatifKeIndex = c['jumlahKemasan']! + 1;
  final groups = <String, List<({String satuan, num jumlahKemasan, String relatifKe, num hargaJual})>>{};

  for (final sheetRow in sheetRows.skip(header.headerIndex + 1)) {
    final kodeItem = _cell(sheetRow, c['kodeItem']);
    final satuan = _cell(sheetRow, c['satuan']);
    final relatifKe = _cell(sheetRow, relatifKeIndex);
    final jumlahKemasan = parseImportNumber(_rawCell(sheetRow, c['jumlahKemasan']));
    final hargaJual = parseImportNumber(_rawCell(sheetRow, c['hargaJual']));

    if (kodeItem.isEmpty || satuan.isEmpty || relatifKe.isEmpty || jumlahKemasan == null || jumlahKemasan <= 0 || hargaJual == null || hargaJual < 0) {
      continue;
    }

    (groups[kodeItem] ??= []).add((satuan: satuan, jumlahKemasan: jumlahKemasan, relatifKe: relatifKe, hargaJual: hargaJual));
  }

  final existing = {
    for (final row in db.select(
      'SELECT p.id, p.kode_item, u.code AS satuan FROM products p '
      'LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base_unit = 1 LEFT JOIN units u ON u.id = pu.unit_id',
    ))
      row['kode_item'] as String: (id: row['id'] as int, satuan: (row['satuan'] as String?) ?? ''),
  };

  db.transaction(() {
    for (final entry in groups.entries) {
      final product = existing[entry.key];

      if (product == null) {
        result['dilewatiTidakDitemukan'] = result['dilewatiTidakDitemukan']! + 1;
        continue;
      }

      final rows = entry.value;
      final baseRows = rows.where((r) => r.satuan.toUpperCase() == r.relatifKe.toUpperCase());

      if (baseRows.isEmpty || baseRows.first.satuan.toUpperCase() != product.satuan.trim().toUpperCase()) {
        result['dilewatiSatuanTidakCocok'] = result['dilewatiSatuanTidakCocok']! + 1;
        continue;
      }

      final baseRow = baseRows.first;

      // Each derived row names the unit it is relative to, which may be the base or any
      // other row - follow those references until every row has an absolute conversion.
      final absKonversi = <String, num>{baseRow.satuan.toUpperCase(): 1};
      final derived = rows.where((r) => !identical(r, baseRow)).toList();
      var remaining = derived;
      var progress = true;

      while (remaining.isNotEmpty && progress) {
        progress = false;
        remaining = remaining.where((r) {
          final relKonversi = absKonversi[r.relatifKe.toUpperCase()];

          if (relKonversi == null) {
            return true;
          }

          absKonversi[r.satuan.toUpperCase()] = r.jumlahKemasan * relKonversi;
          progress = true;

          return false;
        }).toList();
      }

      if (remaining.isNotEmpty) {
        result['dilewatiRantaiTidakValid'] = result['dilewatiRantaiTidakValid']! + 1;
        continue;
      }

      // The app stores each unit's jumlahKemasan relative to the tier directly below, so
      // re-derive it from the absolute conversions rather than trusting the file's values.
      final sorted = [for (final r in derived) (row: r, abs: absKonversi[r.satuan.toUpperCase()]!)]..sort((a, b) => a.abs.compareTo(b.abs));
      final finalUnits = <({String satuan, int jumlahKemasan, int konversi, num hargaJual})>[];
      num prevKonversi = 1;
      var chainValid = true;

      for (final unit in sorted) {
        final ratio = unit.abs / prevKonversi;
        final rounded = ratio.round();

        if (unit.row.satuan.length > 20 || rounded < 1 || (ratio - rounded).abs() > 0.01) {
          chainValid = false;
          break;
        }

        finalUnits.add((satuan: unit.row.satuan, jumlahKemasan: rounded, konversi: unit.abs.round(), hargaJual: unit.row.hargaJual));
        prevKonversi = unit.abs;
      }

      if (!chainValid) {
        result['dilewatiRantaiTidakValid'] = result['dilewatiRantaiTidakValid']! + 1;
        continue;
      }

      if (finalUnits.isEmpty) {
        continue;
      }

      final now = nowSeconds();

      for (final unit in finalUnits) {
        final unitId = resolveOrCreateUnit(db, unit.satuan);
        final existingUnit = db.scalar<int>(
          'SELECT id FROM product_units WHERE product_id = ? AND unit_id = ? AND is_base_unit = 0',
          [product.id, unitId],
        );

        if (existingUnit != null) {
          db.execute(
            'UPDATE product_units SET jumlah_kemasan = ?, conversion_factor = ?, harga_jual = ?, updated_at = ? WHERE id = ?',
            [unit.jumlahKemasan, unit.konversi, toCents(unit.hargaJual), now, existingUnit],
          );
        } else {
          db.insert(
            'INSERT INTO product_units (product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, created_at, updated_at) '
            'VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
            [product.id, unitId, unit.jumlahKemasan, unit.konversi, toCents(unit.hargaJual), now, now],
          );
        }

        result['satuanDitambahkan'] = result['satuanDitambahkan']! + 1;
      }

      result['produkDiperbarui'] = result['produkDiperbarui']! + 1;
    }
  });

  return result;
}

const _importTierLabels = {
  'kodeItem': ['kode item'],
  'satuan': ['satuan'],
  'jml1': ['jml 1'],
  'hargaJml1': ['harga jml 1'],
  'jml2': ['jml 2'],
  'hargaJml2': ['harga jml 2'],
  'jml3': ['jml 3'],
  'hargaJml3': ['harga jml 3'],
  'jml4': ['jml 4'],
  'hargaJml4': ['harga jml 4'],
};

/// Reads a legacy "harga bertingkat" export: one row per product satuan with up to four
/// (Jml N, Harga Jml N) pairs. For every satuan the file prices, its tiers are replaced
/// wholesale so a re-import converges instead of piling up stale rows.
Map<String, int> importHargaBertingkat(Db db, SheetRows sheetRows) {
  final result = {'satuanDiperbarui': 0, 'tierDitambahkan': 0, 'dilewatiProdukTidakDitemukan': 0, 'dilewatiSatuanTidakDitemukan': 0};
  final header = _findHeader(sheetRows, _importTierLabels, ['kodeItem', 'satuan', 'jml1', 'hargaJml1']);

  if (header == null) {
    return result;
  }

  final c = header.columns;

  db.transaction(() {
    final now = nowSeconds();

    for (final sheetRow in sheetRows.skip(header.headerIndex + 1)) {
      final kodeItem = _cell(sheetRow, c['kodeItem']);
      final satuan = _cell(sheetRow, c['satuan']).toUpperCase();

      if (kodeItem.isEmpty || satuan.isEmpty) {
        continue;
      }

      // parsed before the lookups so a row with no tiers - the common case - is never
      // counted as a miss and never deletes anything
      final byMinQty = <int, int>{};

      for (var n = 1; n <= 4; n++) {
        if (c['jml$n'] == null || c['hargaJml$n'] == null) {
          continue;
        }

        final minQty = parseImportNumber(_rawCell(sheetRow, c['jml$n']));
        final harga = parseImportNumber(_rawCell(sheetRow, c['hargaJml$n']));

        if (minQty == null || harga == null || minQty != minQty.roundToDouble() || minQty <= 0 || harga <= 0) {
          continue;
        }

        byMinQty[minQty.toInt()] = toCents(harga);
      }

      if (byMinQty.isEmpty) {
        continue;
      }

      final productId = db.scalar<int>('SELECT id FROM products WHERE kode_item = ?', [kodeItem]);

      if (productId == null) {
        result['dilewatiProdukTidakDitemukan'] = result['dilewatiProdukTidakDitemukan']! + 1;
        continue;
      }

      final productUnitId = db.scalar<int>(
        'SELECT pu.id FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id = ? AND u.code = ? ORDER BY pu.is_base_unit DESC',
        [productId, satuan],
      );

      if (productUnitId == null) {
        result['dilewatiSatuanTidakDitemukan'] = result['dilewatiSatuanTidakDitemukan']! + 1;
        continue;
      }

      db.execute('DELETE FROM product_price_tiers WHERE product_unit_id = ?', [productUnitId]);

      for (final tier in byMinQty.entries) {
        db.insert(
          'INSERT INTO product_price_tiers (product_id, product_unit_id, min_qty, max_qty, harga_jual, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
          [productId, productUnitId, tier.key, tier.value, now, now],
        );
        result['tierDitambahkan'] = result['tierDitambahkan']! + 1;
      }

      result['satuanDiperbarui'] = result['satuanDiperbarui']! + 1;
    }
  });

  return result;
}

/// Reads a barcode-only sheet (Kode Item + Kode Barcode). Never creates products, never
/// clears a barcode from a blank cell, and skips a barcode already on another product.
Map<String, int> importBarcode(Db db, SheetRows sheetRows) {
  final result = {
    'diperbarui': 0,
    'dilewatiSudahSama': 0,
    'dilewatiProdukTidakDitemukan': 0,
    'dilewatiBarcodeDipakai': 0,
    'dilewatiBarcodeTerlaluPanjang': 0,
  };
  final header = _findHeader(sheetRows, {'kodeItem': ['kode item'], 'barcode': ['kode barcode', 'barcode']}, ['kodeItem', 'barcode']);

  if (header == null) {
    return result;
  }

  final c = header.columns;

  void bump(String key) => result[key] = result[key]! + 1;

  db.transaction(() {
    for (final sheetRow in sheetRows.skip(header.headerIndex + 1)) {
      final kodeItem = _cell(sheetRow, c['kodeItem']);
      final barcode = _cell(sheetRow, c['barcode']);

      if (kodeItem.isEmpty || barcode.isEmpty) {
        continue;
      }

      if (barcode.length > 100) {
        bump('dilewatiBarcodeTerlaluPanjang');
        continue;
      }

      final product = db.first('SELECT id, barcode FROM products WHERE kode_item = ?', [kodeItem]);

      if (product == null) {
        bump('dilewatiProdukTidakDitemukan');
        continue;
      }

      if (product['barcode'] == barcode) {
        bump('dilewatiSudahSama');
        continue;
      }

      if (_collides(db, 'barcode', barcode, product['id'] as int)) {
        bump('dilewatiBarcodeDipakai');
        continue;
      }

      db.execute('UPDATE products SET barcode = ?, updated_at = ? WHERE id = ?', [barcode, nowSeconds(), product['id']]);
      bump('diperbarui');
    }
  });

  return result;
}
