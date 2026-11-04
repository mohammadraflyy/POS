/// Cash paid out for something other than goods - DPAM, payroll, fuel. Goods purchases are
/// excluded on purpose: they already live in `purchases`, and recording them here too would
/// double them in the cash book.
library;

import '../core/errors.dart';
import '../core/money.dart';
import '../db/db.dart';

class ExpenseInput {
  const ExpenseInput({required this.tanggal, required this.kategori, required this.jumlah, this.keterangan});

  /// `YYYY-MM-DD`.
  final String tanggal;
  final String kategori;

  /// Cents.
  final int jumlah;
  final String? keterangan;
}

({String tanggal, String kategori, String? keterangan}) _validate(ExpenseInput input) {
  if (input.tanggal.trim().isEmpty) {
    throw BusinessException('Tanggal wajib diisi.');
  }

  final kategori = input.kategori.trim();

  if (kategori.isEmpty) {
    throw BusinessException('Kategori wajib diisi.');
  }

  if (kategori.length > 50) {
    throw BusinessException('Kategori maksimal 50 karakter.');
  }

  if (input.jumlah <= 0) {
    throw BusinessException('Jumlah harus lebih dari 0.');
  }

  final note = input.keterangan?.trim();
  final keterangan = note == null || note.isEmpty ? null : note;

  if (keterangan != null && keterangan.length > 500) {
    throw BusinessException('Keterangan maksimal 500 karakter.');
  }

  return (tanggal: input.tanggal.trim(), kategori: kategori, keterangan: keterangan);
}

int recordCashExpense(Db db, ExpenseInput input, {int? userId}) {
  final clean = _validate(input);
  final now = nowSeconds();

  return db.insert(
    'INSERT INTO cash_expenses (user_id, tanggal, kategori, jumlah, keterangan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, clean.tanggal, clean.kategori, input.jumlah, clean.keterangan, now, now],
  );
}

void updateCashExpense(Db db, int id, ExpenseInput input) {
  if (db.first('SELECT id FROM cash_expenses WHERE id = ?', [id]) == null) {
    throw BusinessException('Pengeluaran tidak ditemukan.');
  }

  final clean = _validate(input);

  db.execute(
    'UPDATE cash_expenses SET tanggal = ?, kategori = ?, jumlah = ?, keterangan = ?, updated_at = ? WHERE id = ?',
    [clean.tanggal, clean.kategori, input.jumlah, clean.keterangan, nowSeconds(), id],
  );
}

void deleteCashExpense(Db db, int id) {
  if (db.first('SELECT id FROM cash_expenses WHERE id = ?', [id]) == null) {
    throw BusinessException('Pengeluaran tidak ditemukan.');
  }

  db.execute('DELETE FROM cash_expenses WHERE id = ?', [id]);
}

/// Shared by the paginated list and the unpaginated export, so they never drift apart.
({String where, List<Object?> params}) _filter({String? from, String? to, String? q}) {
  final conditions = <String>[];
  final params = <Object?>[];

  if (from != null && from.isNotEmpty) {
    conditions.add('e.tanggal >= ?');
    params.add(from);
  }

  if (to != null && to.isNotEmpty) {
    conditions.add('e.tanggal <= ?');
    params.add(to);
  }

  final keyword = q?.trim() ?? '';

  if (keyword.isNotEmpty) {
    conditions.add('(e.kategori LIKE ? OR e.keterangan LIKE ?)');
    params.addAll(['%$keyword%', '%$keyword%']);
  }

  return (where: conditions.isEmpty ? '' : 'WHERE ${conditions.join(' AND ')}', params: params);
}

const _select = 'SELECT e.id, e.tanggal, e.kategori, e.jumlah, e.keterangan, u.name AS user_name FROM cash_expenses e LEFT JOIN users u ON u.id = e.user_id';

Map<String, Object?> _json(Row row) => {
      'id': row['id'],
      'tanggal': row['tanggal'],
      'kategori': row['kategori'],
      'jumlah': rupiahJson(row['jumlah'] as int),
      'keterangan': row['keterangan'],
      'userName': row['user_name'],
    };

const _defaultPageSize = 25;
const _validPageSizes = [10, 25, 50, 100];

/// `totalJumlah` sums every matching row, not just the returned page.
Map<String, Object?> listCashExpenses(Db db, {String? from, String? to, String? q, int page = 1, int? pageSize}) {
  final size = pageSize != null && _validPageSizes.contains(pageSize) ? pageSize : _defaultPageSize;
  final currentPage = page < 1 ? 1 : page;
  final filter = _filter(from: from, to: to, q: q);
  final totals = db.first('SELECT count(*) AS n, coalesce(sum(e.jumlah), 0) AS jumlah FROM cash_expenses e ${filter.where}', filter.params)!;
  final total = totals['n'] as int;
  final rows = db.select('$_select ${filter.where} ORDER BY e.tanggal DESC, e.id DESC LIMIT ? OFFSET ?', [...filter.params, size, (currentPage - 1) * size]);

  return {
    'data': rows.map(_json).toList(),
    'currentPage': currentPage,
    'lastPage': total == 0 ? 1 : (total / size).ceil(),
    'total': total,
    'totalJumlah': rupiahJson(totals['jumlah'] as int),
  };
}

/// Every row a filter matches, for the Excel export, which must not stop at one page.
List<Map<String, Object?>> listAllCashExpenses(Db db, {String? from, String? to, String? q}) {
  final filter = _filter(from: from, to: to, q: q);

  return db.select('$_select ${filter.where} ORDER BY e.tanggal DESC, e.id DESC', filter.params).map(_json).toList();
}
