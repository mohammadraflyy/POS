import '../core/errors.dart';
import 'db.dart';

/// Parents before children, so the copy reads naturally even though foreign keys are
/// switched off while it runs.
const legacyTables = [
  'users',
  'categories',
  'units',
  'customers',
  'suppliers',
  'store_settings',
  'products',
  'product_units',
  'product_price_tiers',
  'product_price_histories',
  'sales',
  'sale_items',
  'sale_edits',
  'sale_cost_corrections',
  'bon_payments',
  'purchases',
  'purchase_items',
  'purchase_payments',
  'cash_expenses',
  'stock_adjustments',
  'stock_movements',
  'device_tokens',
];

/// Copies every row of the desktop app's database (`pos.sqlite`) into [target], which
/// must not hold any shop data yet. Ids are kept, so every reference still lines up.
///
/// Columns are matched by name: one the old file lacks (an older desktop version) takes
/// its default here, and one only the old file has is ignored. The old file is only read.
Map<String, int> importLegacyDatabase(Db target, String sourcePath) {
  final occupied = [
    for (final table in ['products', 'sales', 'purchases'])
      if ((target.scalar<int>('SELECT count(*) FROM $table') ?? 0) > 0) table,
  ];

  if (occupied.isNotEmpty) {
    throw BusinessException('Database tujuan sudah berisi data (${occupied.join(', ')}). Impor hanya bisa ke database baru.');
  }

  // attached by plain path: this sqlite build does not take URI filenames, so `mode=ro`
  // is not available - the import only ever SELECTs from it
  target.raw.execute('ATTACH DATABASE ? AS legacy', [sourcePath]);

  try {
    final legacyTablesPresent = {
      for (final row in target.select("SELECT name FROM legacy.sqlite_master WHERE type = 'table'")) row['name'] as String,
    };

    if (!legacyTablesPresent.contains('products') || !legacyTablesPresent.contains('sales')) {
      throw BusinessException('File ini bukan database POS desktop.');
    }

    target.raw.execute('PRAGMA foreign_keys = OFF');

    try {
      return target.transaction(() {
        final counts = <String, int>{};

        // the fresh database's default admin would collide with the imported accounts
        target.execute('DELETE FROM users');

        for (final table in legacyTables.where(legacyTablesPresent.contains)) {
          final targetColumns = {for (final row in target.select('PRAGMA main.table_info($table)')) row['name'] as String};
          final sourceColumns = [
            for (final row in target.select('PRAGMA legacy.table_info($table)'))
              if (targetColumns.contains(row['name'])) row['name'] as String,
          ];
          final columns = sourceColumns.join(', ');

          counts[table] = target.execute('INSERT INTO main.$table ($columns) SELECT $columns FROM legacy.$table');
        }

        final violations = target.select('PRAGMA main.foreign_key_check');

        if (violations.isNotEmpty) {
          throw BusinessException('Data lama punya ${violations.length} referensi yang rusak (contoh: tabel ${violations.first['table']}). Impor dibatalkan.');
        }

        return counts;
      });
    } finally {
      target.raw.execute('PRAGMA foreign_keys = ON');
    }
  } finally {
    target.raw.execute('DETACH DATABASE legacy');
  }
}
