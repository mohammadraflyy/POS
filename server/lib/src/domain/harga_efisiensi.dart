/// Bulk price raises: preview which selling prices would move, then apply the same plan,
/// recomputed from live costs so a stale preview never writes stale numbers.
library;

import '../core/errors.dart';
import '../core/money.dart';
import '../db/db.dart';

/// Prices land on a round figure; money is stored in sen, so Rp 100 is 10000.
const _pembulatan = 10000;

/// The highest margin worth computing from - above this the arithmetic explodes.
const _marginMaks = 90;

/// A price this far under the recommendation is a broken master row (a conversion typed
/// wrong, a cost from another packaging), so it is reported instead of changed.
const _batasMencurigakan = 1.5;

/// Lowest price that still leaves [marginPersen] of the price as profit, rounded up to Rp 100.
int hargaJualRekomendasi(num hargaPokok, num marginPersen) {
  if (!hargaPokok.isFinite || hargaPokok <= 0) {
    return 0;
  }

  final margin = (marginPersen.isFinite ? marginPersen : 0).clamp(0, _marginMaks);

  return (hargaPokok / (1 - margin / 100) / _pembulatan).ceil() * _pembulatan;
}

/// `rugi` touches only what sells below cost, `margin` everything under the shop's minimum
/// margin, `semua` every priced row.
const cakupanEfisiensi = ['rugi', 'margin', 'semua'];

/// `margin_minimal` derives the price from cost; `persen` and `nominal` raise the current one.
const metodeEfisiensi = ['margin_minimal', 'persen', 'nominal'];

class FilterEfisiensi {
  const FilterEfisiensi({required this.cakupan, required this.metode, this.nilai, this.categoryId});

  final String cakupan;
  final String metode;

  /// Percent for `persen`, cents for `nominal`; ignored by `margin_minimal`.
  final num? nilai;

  /// Null means every category, uncategorised products included.
  final int? categoryId;
}

void _assertFilter(FilterEfisiensi filter) {
  if (!cakupanEfisiensi.contains(filter.cakupan) || !metodeEfisiensi.contains(filter.metode)) {
    throw BusinessException('Pilihan efisiensi harga tidak valid.');
  }

  if (filter.metode == 'margin_minimal') {
    return;
  }

  final nilai = filter.nilai;

  if (nilai == null || !nilai.isFinite || nilai <= 0) {
    throw BusinessException('Besar kenaikan wajib diisi dan harus lebih dari 0.');
  }

  // a raise beyond this is a typo, not a price list
  if (filter.metode == 'persen' && nilai > 500) {
    throw BusinessException('Kenaikan persen terlalu besar.');
  }
}

/// Rounds up to the next Rp 100. The input is rounded to whole sen first, so float noise
/// (`900000 * 1.1 = 990000.0000000001`) cannot push an exact price up a step.
int _bulatkanNaik(num sen) => (sen.round() / _pembulatan).ceil() * _pembulatan;

int _hitungHargaBaru(int hargaLama, int hargaMinimal, FilterEfisiensi filter) {
  return switch (filter.metode) {
    'persen' => _bulatkanNaik(hargaLama * (1 + (filter.nilai ?? 0) / 100)),
    'nominal' => _bulatkanNaik(hargaLama + (filter.nilai ?? 0)),
    _ => hargaMinimal,
  };
}

class _Baris {
  _Baris(this.jenis, this.id, this.productId, this.namaItem, this.satuan, this.minQty, this.hargaPokok, this.hargaLama);

  final String jenis;
  final int id;
  final int productId;
  final String namaItem;
  final String satuan;
  final int? minQty;
  final int hargaPokok;
  final int hargaLama;
  int hargaBaru = 0;
}

({int marginMinimalPersen, List<_Baris> baris, List<_Baris> dilewati}) _rencanakan(Db db, FilterEfisiensi filter) {
  _assertFilter(filter);

  final marginMinimal = db.scalar<int>('SELECT margin_minimal_persen FROM store_settings LIMIT 1') ?? 10;
  final baris = <_Baris>[];
  final dilewati = <_Baris>[];

  void pertimbangkan(_Baris row) {
    // an unpriced satuan has nothing to raise
    if (row.hargaLama <= 0) {
      return;
    }

    // only the cost-derived method needs a cost; a flat raise works off the price alone
    if (row.hargaPokok <= 0 && (filter.metode == 'margin_minimal' || filter.cakupan != 'semua')) {
      return;
    }

    final hargaMinimal = hargaJualRekomendasi(row.hargaPokok, marginMinimal);
    final perluNaik = switch (filter.cakupan) {
      'rugi' => row.hargaLama < row.hargaPokok,
      'margin' => row.hargaLama < hargaMinimal,
      _ => true,
    };

    if (!perluNaik) {
      return;
    }

    row.hargaBaru = _hitungHargaBaru(row.hargaLama, hargaMinimal, filter);

    if (row.hargaBaru <= row.hargaLama) {
      return;
    }

    // only the cost-derived price trusts harga_pokok, so only it can run away like this
    if (filter.metode == 'margin_minimal' && row.hargaBaru > row.hargaLama * _batasMencurigakan) {
      dilewati.add(row);

      return;
    }

    baris.add(row);
  }

  final categoryWhere = filter.categoryId == null ? '' : 'WHERE p.category_id = ?';
  final params = [?filter.categoryId];

  for (final row in db.select(
    'SELECT pu.id, pu.product_id, p.nama_item, u.code AS satuan, pu.harga_jual, pu.harga_pokok FROM product_units pu '
    'JOIN products p ON p.id = pu.product_id JOIN units u ON u.id = pu.unit_id $categoryWhere ORDER BY pu.id',
    params,
  )) {
    pertimbangkan(_Baris('satuan', row['id'] as int, row['product_id'] as int, row['nama_item'] as String, row['satuan'] as String, null,
        row['harga_pokok'] as int, row['harga_jual'] as int));
  }

  for (final row in db.select(
    'SELECT t.id, t.product_id, p.nama_item, u.code AS satuan, t.min_qty, t.harga_jual, pu.harga_pokok FROM product_price_tiers t '
    'JOIN product_units pu ON pu.id = t.product_unit_id JOIN products p ON p.id = t.product_id JOIN units u ON u.id = pu.unit_id '
    '$categoryWhere ORDER BY t.id',
    params,
  )) {
    pertimbangkan(_Baris('tier', row['id'] as int, row['product_id'] as int, row['nama_item'] as String, row['satuan'] as String,
        row['min_qty'] as int, row['harga_pokok'] as int, row['harga_jual'] as int));
  }

  // biggest correction first; the index keeps equal raises in their original order
  final indexed = baris.indexed.toList()
    ..sort((a, b) {
      final byRaise = (b.$2.hargaBaru - b.$2.hargaLama).compareTo(a.$2.hargaBaru - a.$2.hargaLama);

      return byRaise != 0 ? byRaise : a.$1.compareTo(b.$1);
    });

  return (marginMinimalPersen: marginMinimal, baris: [for (final entry in indexed) entry.$2], dilewati: dilewati);
}

Map<String, Object?> rencanakanEfisiensiHarga(Db db, FilterEfisiensi filter) {
  final rencana = _rencanakan(db, filter);

  return {
    // a percentage, not money
    'marginMinimalPersen': rencana.marginMinimalPersen,
    'baris': [
      for (final row in rencana.baris)
        {
          'jenis': row.jenis,
          'id': row.id,
          'productId': row.productId,
          'namaItem': row.namaItem,
          'satuan': row.satuan,
          'minQty': row.minQty,
          'hargaPokok': rupiahJson(row.hargaPokok),
          'hargaLama': rupiahJson(row.hargaLama),
          'hargaBaru': rupiahJson(row.hargaBaru),
        },
    ],
    'dilewati': [
      for (final row in rencana.dilewati)
        {
          'namaItem': row.namaItem,
          'satuan': row.satuan,
          'hargaPokok': rupiahJson(row.hargaPokok),
          'hargaLama': rupiahJson(row.hargaLama),
          'hargaBaru': rupiahJson(row.hargaBaru),
        },
    ],
  };
}

/// Applies the plan in one transaction, recomputed from live costs and narrowed to the rows
/// the owner ticked. [satuanIds]/[tierIds] null means everything in the plan.
Map<String, int> terapkanEfisiensiHarga(Db db, FilterEfisiensi filter, {List<int>? satuanIds, List<int>? tierIds, bool pilihSemua = true, int? userId}) {
  return db.transaction(() {
    final rencana = _rencanakan(db, filter);
    final satuan = rencana.baris.where((row) => row.jenis == 'satuan' && (pilihSemua || (satuanIds ?? const []).contains(row.id))).toList();
    final tier = rencana.baris.where((row) => row.jenis == 'tier' && (pilihSemua || (tierIds ?? const []).contains(row.id))).toList();
    final now = nowSeconds();

    for (final row in satuan) {
      db.execute('UPDATE product_units SET harga_jual = ?, updated_at = ? WHERE id = ?', [row.hargaBaru, now, row.id]);

      // products.harga_jual mirrors the base unit's price
      if (db.scalar<int>('SELECT is_base_unit FROM product_units WHERE id = ?', [row.id]) == 1) {
        db.execute('UPDATE products SET harga_jual = ?, updated_at = ? WHERE id = ?', [row.hargaBaru, now, row.productId]);
      }

      // the cost did not move, only the price
      db.insert(
        'INSERT INTO product_price_histories (product_id, user_id, harga_pokok_lama, harga_pokok_baru, harga_jual_lama, harga_jual_baru, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [row.productId, userId, row.hargaPokok, row.hargaPokok, row.hargaLama, row.hargaBaru, now, now],
      );
    }

    for (final row in tier) {
      db.execute('UPDATE product_price_tiers SET harga_jual = ?, updated_at = ? WHERE id = ?', [row.hargaBaru, now, row.id]);
    }

    return {'satuanDiubah': satuan.length, 'tierDiubah': tier.length, 'dilewati': rencana.dilewati.length};
  });
}
