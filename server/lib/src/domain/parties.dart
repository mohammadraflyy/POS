/// Customers and suppliers: the same small master-record shape, one table each.
library;

import '../core/errors.dart';
import '../db/db.dart';

const _defaultPageSize = 25;
const _validPageSizes = [10, 25, 50, 100];

class PartyInput {
  const PartyInput({required this.nama, this.telepon, this.alamat, this.keterangan});

  final String nama;
  final String? telepon;
  final String? alamat;
  final String? keterangan;
}

void _validate(PartyInput input) {
  if (input.nama.trim().isEmpty) {
    throw BusinessException('Nama wajib diisi.');
  }

  if (input.nama.length > 255) {
    throw BusinessException('Nama maksimal 255 karakter.');
  }
}

Map<String, Object?> _list(Db db, String table, String countSql, String countKey, {String? search, int page = 1, int? pageSize}) {
  final size = pageSize != null && _validPageSizes.contains(pageSize) ? pageSize : _defaultPageSize;
  final currentPage = page < 1 ? 1 : page;
  final hasSearch = search != null && search.isNotEmpty;
  final where = hasSearch ? 'WHERE nama LIKE ?' : '';
  final params = hasSearch ? ['%$search%'] : <Object?>[];
  final total = db.scalar<int>('SELECT count(*) FROM $table $where', params) ?? 0;
  final rows = db.select(
    'SELECT id, nama, telepon, alamat, keterangan, ($countSql) AS n FROM $table $where ORDER BY nama LIMIT ? OFFSET ?',
    [...params, size, (currentPage - 1) * size],
  );

  return {
    'data': [
      for (final row in rows)
        {
          'id': row['id'],
          'nama': row['nama'],
          'telepon': row['telepon'],
          'alamat': row['alamat'],
          'keterangan': row['keterangan'],
          countKey: row['n'],
        },
    ],
    'currentPage': currentPage,
    'lastPage': total == 0 ? 1 : (total / size).ceil(),
    'total': total,
  };
}

int _create(Db db, String table, PartyInput input) {
  _validate(input);
  final now = nowSeconds();

  return db.insert(
    'INSERT INTO $table (nama, telepon, alamat, keterangan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [input.nama, input.telepon, input.alamat, input.keterangan, now, now],
  );
}

void _update(Db db, String table, int id, PartyInput input) {
  _validate(input);
  db.execute(
    'UPDATE $table SET nama = ?, telepon = ?, alamat = ?, keterangan = ?, updated_at = ? WHERE id = ?',
    [input.nama, input.telepon, input.alamat, input.keterangan, nowSeconds(), id],
  );
}

// Customers ------------------------------------------------------------------

Map<String, Object?> listCustomers(Db db, {String? search, int page = 1, int? pageSize}) =>
    _list(db, 'customers', 'SELECT COUNT(*) FROM sales WHERE customer_id = customers.id', 'saleCount',
        search: search, page: page, pageSize: pageSize);

/// Names only, ordered for the register's customer picker.
List<String> listCustomerNames(Db db) => [for (final row in db.select('SELECT nama FROM customers ORDER BY nama')) row['nama'] as String];

int createCustomer(Db db, PartyInput input) => _create(db, 'customers', input);

void updateCustomer(Db db, int id, PartyInput input) => _update(db, 'customers', id, input);

/// Past sales keep their `nama_pelanggan` snapshot; `customer_id` is set null by the FK.
void deleteCustomer(Db db, int id) => db.execute('DELETE FROM customers WHERE id = ?', [id]);

/// The id of the customer with this name, creating the row when there is none. Matching
/// ignores case, because the register's picker already treats "Budi" and "budi" as one.
int? findOrCreateCustomerByName(Db db, String nama) {
  final trimmed = nama.trim();

  if (trimmed.isEmpty) {
    return null;
  }

  final existing = db.scalar<int>('SELECT id FROM customers WHERE lower(nama) = lower(?) ORDER BY id LIMIT 1', [trimmed]);

  if (existing != null) {
    return existing;
  }

  final now = nowSeconds();

  return db.insert(
    'INSERT INTO customers (nama, telepon, alamat, keterangan, created_at, updated_at) VALUES (?, NULL, NULL, NULL, ?, ?)',
    [trimmed, now, now],
  );
}

// Suppliers ------------------------------------------------------------------

Map<String, Object?> listSuppliers(Db db, {String? search, int page = 1, int? pageSize}) =>
    _list(db, 'suppliers', 'SELECT COUNT(*) FROM purchases WHERE supplier_id = suppliers.id', 'purchaseCount',
        search: search, page: page, pageSize: pageSize);

int createSupplier(Db db, PartyInput input) => _create(db, 'suppliers', input);

void updateSupplier(Db db, int id, PartyInput input) => _update(db, 'suppliers', id, input);

void deleteSupplier(Db db, int id) => db.execute('DELETE FROM suppliers WHERE id = ?', [id]);
