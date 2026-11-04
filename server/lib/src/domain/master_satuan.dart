import '../core/errors.dart';
import '../db/db.dart';

String _normalizeCode(String code) => code.trim().toUpperCase();

void _validate(String code, String name, String symbol) {
  if (code.trim().isEmpty) {
    throw BusinessException('Kode satuan wajib diisi.');
  }

  if (name.trim().isEmpty) {
    throw BusinessException('Nama wajib diisi.');
  }

  if (symbol.trim().isEmpty) {
    throw BusinessException('Simbol wajib diisi.');
  }
}

List<Map<String, Object?>> listUnits(Db db) {
  return [
    for (final row in db.select('SELECT id, code, name, symbol, is_active FROM units ORDER BY code'))
      {'id': row['id'], 'code': row['code'], 'name': row['name'], 'symbol': row['symbol'], 'isActive': asBool(row['is_active'])},
  ];
}

/// Maps free satuan text (from the product form or an import sheet) onto a `units`
/// row, creating one on first sight.
int resolveOrCreateUnit(Db db, String satuanText) {
  final code = _normalizeCode(satuanText);

  if (code.isEmpty) {
    throw BusinessException('Satuan wajib diisi.');
  }

  final existing = db.scalar<int>('SELECT id FROM units WHERE code = ?', [code]);

  if (existing != null) {
    return existing;
  }

  final label = satuanText.trim();
  final now = nowSeconds();

  return db.insert(
    'INSERT INTO units (code, name, symbol, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    [code, label, label.toLowerCase(), now, now],
  );
}

int createUnit(Db db, {required String code, required String name, required String symbol}) {
  _validate(code, name, symbol);
  final normalized = _normalizeCode(code);

  if (db.scalar<int>('SELECT id FROM units WHERE code = ?', [normalized]) != null) {
    throw BusinessException('Kode satuan sudah ada.');
  }

  final now = nowSeconds();

  return db.insert(
    'INSERT INTO units (code, name, symbol, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    [normalized, name.trim(), symbol.trim(), now, now],
  );
}

void updateUnit(Db db, int id, {required String code, required String name, required String symbol, required bool isActive}) {
  _validate(code, name, symbol);
  final normalized = _normalizeCode(code);

  if (db.scalar<int>('SELECT id FROM units WHERE id = ?', [id]) == null) {
    throw BusinessException('Satuan tidak ditemukan.');
  }

  final duplicate = db.scalar<int>('SELECT id FROM units WHERE code = ?', [normalized]);

  if (duplicate != null && duplicate != id) {
    throw BusinessException('Kode satuan sudah ada.');
  }

  db.execute(
    'UPDATE units SET code = ?, name = ?, symbol = ?, is_active = ?, updated_at = ? WHERE id = ?',
    [normalized, name.trim(), symbol.trim(), isActive ? 1 : 0, nowSeconds(), id],
  );
}

void deactivateUnit(Db db, int id) {
  db.execute('UPDATE units SET is_active = 0, updated_at = ? WHERE id = ?', [nowSeconds(), id]);
}
