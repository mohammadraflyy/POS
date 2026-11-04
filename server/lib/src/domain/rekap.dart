import '../core/money.dart';
import '../db/db.dart';

/// The local calendar day, in the `YYYY-MM-DD` shape the report ranges are given in.
String tanggalLokal(DateTime date) =>
    '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

/// A discount that leaves less than this share of the margin standing is worth flagging.
const _ambangSisaMargin = 0.5;

/// A satuan selling thinner than this is worth pointing at by name.
const _ambangMarginSatuan = 5;

class _Diakui {
  _Diakui(this.tanggal, this.metodePembayaran, this.total, this.diskon, this.biayaLain);

  final String tanggal;
  final String metodePembayaran;
  final int total;
  final int diskon;
  final int biayaLain;
}

const _rangeFilter = "s.status = 'selesai' AND (s.metode_pembayaran = 'bon' OR (s.metode_pembayaran != 'bon' AND s.created_at >= ? AND s.created_at <= ?))";

/// Every sale whose money lands inside the range, and the day it landed. The report is on
/// a cash basis: cash, QRIS and transfer count on the day of sale; a bon counts for nothing
/// until it is paid off, then on the day of the payment that cleared it. A bon marked paid
/// with no payment rows falls back to its own date.
Map<int, _Diakui> _pengakuanPenjualan(Db db, DateTime start, DateTime end) {
  final rows = db.select(
    'SELECT s.id, s.metode_pembayaran, s.total, s.diskon, s.biaya_lain, s.dibayar, s.created_at FROM sales s WHERE $_rangeFilter',
    [toEpochSeconds(start), toEpochSeconds(end)],
  );
  final pelunasan = {
    for (final row in db.select('SELECT sale_id, max(tanggal) AS tanggal FROM bon_payments GROUP BY sale_id')) row['sale_id'] as int: row['tanggal'] as String,
  };
  final from = tanggalLokal(start);
  final to = tanggalLokal(end);
  final diakui = <int, _Diakui>{};

  for (final sale in rows) {
    var tanggal = tanggalLokal(fromEpochSeconds(sale['created_at'] as int));

    if (sale['metode_pembayaran'] == 'bon') {
      if ((sale['dibayar'] as int) < (sale['total'] as int)) {
        continue;
      }

      tanggal = pelunasan[sale['id']] ?? tanggal;
    }

    if (tanggal.compareTo(from) < 0 || tanggal.compareTo(to) > 0) {
      continue;
    }

    diakui[sale['id'] as int] = _Diakui(tanggal, sale['metode_pembayaran'] as String, sale['total'] as int, sale['diskon'] as int, sale['biaya_lain'] as int);
  }

  return diakui;
}

class _Agg {
  num qty = 0;
  num omzet = 0;
  num laba = 0;
}

Map<String, Object?> getRekap(Db db, {required String from, required String to}) {
  final start = DateTime.parse('${from}T00:00:00');
  final end = DateTime.parse('${to}T23:59:59');
  final diakui = _pengakuanPenjualan(db, start, end);
  var omzetTunai = 0;
  var omzetNonTunai = 0;

  for (final sale in diakui.values) {
    // qris and transfer are takings the till never sees; the cash book needs them apart
    if (sale.metodePembayaran == 'qris' || sale.metodePembayaran == 'transfer') {
      omzetNonTunai += sale.total;
    } else {
      omzetTunai += sale.total;
    }
  }

  // max(...,0) per row: an overpaid bon must not understate everyone else's balance
  final piutangBeredar =
      db.scalar<int>("SELECT coalesce(sum(max(total - dibayar, 0)), 0) FROM sales WHERE status = 'selesai' AND metode_pembayaran = 'bon'") ?? 0;

  // who owes what, all-time, grouped by customer so a renamed customer stays on one line
  final piutangPerPelanggan = db.select(
    "SELECT s.customer_id, coalesce(c.nama, s.nama_pelanggan, 'Tanpa Nama') AS nama_pelanggan, c.telepon, "
    'coalesce(sum(max(s.total - s.dibayar, 0)), 0) AS total_piutang, count(CASE WHEN s.total > s.dibayar THEN 1 END) AS jumlah_bon '
    "FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.status = 'selesai' AND s.metode_pembayaran = 'bon' "
    'GROUP BY s.customer_id HAVING sum(max(s.total - s.dibayar, 0)) > 0 ORDER BY total_piutang DESC',
  );

  final lines = db
      .select(
        'SELECT si.id AS sale_item_id, si.product_unit_id, si.sale_id, c.nama AS category_name, p.id AS product_id, p.nama_item, '
        'si.subtotal, si.qty, si.harga_jual, si.diskon AS diskon_baris, si.harga_pokok, u.code AS unit_code, si.satuan AS satuan_snapshot '
        'FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id '
        'LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN product_units pu ON pu.id = si.product_unit_id LEFT JOIN units u ON u.id = pu.unit_id '
        // deterministic order so the discount remainder always lands on the same line
        'WHERE $_rangeFilter ORDER BY si.sale_id, si.id',
        [toEpochSeconds(start), toEpochSeconds(end)],
      )
      .where((row) => diakui.containsKey(row['sale_id']))
      .toList();

  num labaKotor = 0;
  num totalModal = 0;
  var totalDiskonItem = 0;
  var totalDiskonNota = 0;
  final barisRugi = <Map<String, Object?>>[];
  final perKategori = <String, _Agg>{};
  final perHari = <String, _Agg>{};
  final perSatuan = <String, _Agg>{};
  final perProduk = <int, ({String namaItem, _Agg agg})>{};

  // A bill-wide discount is spread across the sale's lines in proportion to each line's
  // subtotal, each taking its share of what is left, so the remainder lands on the last
  // line and the allocations sum to the discount exactly.
  final sisa = <int, ({int diskon, int subtotal})>{};

  for (final row in lines) {
    final saleId = row['sale_id'] as int;
    final current = sisa[saleId] ?? (diskon: diakui[saleId]!.diskon, subtotal: 0);
    sisa[saleId] = (diskon: current.diskon, subtotal: current.subtotal + (row['subtotal'] as int));
  }

  for (final row in lines) {
    final saleId = row['sale_id'] as int;
    final subtotal = row['subtotal'] as int;
    final current = sisa[saleId]!;
    final alokasi = current.subtotal > 0 ? (current.diskon * subtotal / current.subtotal).round() : 0;
    sisa[saleId] = (diskon: current.diskon - alokasi, subtotal: current.subtotal - subtotal);

    final qty = row['qty'] as num;
    final omzet = subtotal - alokasi;
    // harga_pokok is the cost of one of the unit sold, so qty alone scales it
    final modal = qty * (row['harga_pokok'] as int);
    final laba = omzet - modal;
    final tanggal = diakui[saleId]!.tanggal;
    final satuan = (row['unit_code'] ?? row['satuan_snapshot']) as String?;

    labaKotor += laba;
    totalModal += modal;
    totalDiskonItem += row['diskon_baris'] as int;
    totalDiskonNota += alokasi;

    if (laba < 0) {
      barisRugi.add({
        'saleItemId': row['sale_item_id'],
        'productUnitId': row['product_unit_id'],
        'productId': row['product_id'],
        'saleId': saleId,
        'tanggal': tanggal,
        'namaItem': row['nama_item'],
        'satuan': satuan ?? '-',
        'qty': qty,
        'hargaJual': row['harga_jual'],
        'hargaPokok': row['harga_pokok'],
        'diskon': (row['diskon_baris'] as int) + alokasi,
        'omzet': omzet,
        'modal': modal,
        'laba': laba,
      });
    }

    for (final (map, key) in [
      (perKategori, (row['category_name'] as String?) ?? 'Tanpa Kategori'),
      // filed under the day the money arrived, not the day the goods left
      (perHari, tanggal),
      (perSatuan, satuan ?? 'Tanpa Satuan'),
    ]) {
      final agg = map[key] ??= _Agg();
      agg.qty += qty;
      agg.omzet += omzet;
      agg.laba += laba;
    }

    final produk = perProduk[row['product_id'] as int] ??= (namaItem: row['nama_item'] as String, agg: _Agg());
    produk.agg.qty += qty;
    produk.agg.omzet += omzet;
  }

  // additional charges are income without product cost or stock quantity
  for (final sale in diakui.values.where((sale) => sale.biayaLain != 0)) {
    labaKotor += sale.biayaLain;

    for (final (map, key) in [(perKategori, 'Lain-lain'), (perHari, sale.tanggal), (perSatuan, 'Lain-lain')]) {
      final agg = map[key] ??= _Agg();
      agg.omzet += sale.biayaLain;
      agg.laba += sale.biayaLain;
    }
  }

  final labaPerSatuan = [
    for (final entry in perSatuan.entries)
      (satuan: entry.key, qty: entry.value.qty, omzet: entry.value.omzet, laba: entry.value.laba, margin: entry.value.omzet == 0 ? 0.0 : entry.value.laba / entry.value.omzet * 100),
  ]..sort((a, b) => b.laba.compareTo(a.laba));

  final produkTerlaris = perProduk.values.toList()..sort((a, b) => b.agg.qty.compareTo(a.agg.qty));
  final omzet = omzetTunai + omzetNonTunai;
  final penjualanKotor = omzet + totalDiskonItem + totalDiskonNota;

  final saran = _susunSaran(
    db,
    penjualanKotor: penjualanKotor,
    modal: totalModal,
    labaKotor: labaKotor,
    totalDiskon: totalDiskonItem + totalDiskonNota,
    barisRugi: barisRugi,
    labaPerSatuan: labaPerSatuan,
    barisTerjual: [
      for (final row in lines)
        (productId: row['product_id'] as int, namaItem: row['nama_item'] as String, satuan: ((row['unit_code'] ?? row['satuan_snapshot']) as String?) ?? 'Tanpa Satuan'),
    ],
    saleIdsDiskon: {
      for (final row in lines)
        if ((row['diskon_baris'] as int) > 0 || diakui[row['sale_id']]!.diskon > 0) row['sale_id'] as int,
    }.toList(),
  );

  final rugiTerburuk = [...barisRugi]..sort((a, b) => (a['laba'] as num).compareTo(b['laba'] as num));

  return {
    'summary': {
      'omzetTunai': rupiahJson(omzetTunai),
      'omzetNonTunai': rupiahJson(omzetNonTunai),
      'piutangBeredar': rupiahJson(piutangBeredar),
      'jumlahTransaksi': diakui.length,
      'labaKotor': rupiahJsonNum(labaKotor),
    },
    'penjelasanLaba': {
      // omzet is already net of both discounts, so adding them back gives the list price
      'penjualanKotor': rupiahJson(penjualanKotor),
      'diskonItem': rupiahJson(totalDiskonItem),
      'diskonNota': rupiahJson(totalDiskonNota),
      'omzet': rupiahJson(omzet),
      'modal': rupiahJsonNum(totalModal),
      'labaKotor': rupiahJsonNum(labaKotor),
      'jumlahBarisRugi': barisRugi.length,
      'totalRugi': rupiahJsonNum(barisRugi.fold<num>(0, (sum, row) => sum + (row['laba'] as num))),
      'barisRugi': [
        for (final row in rugiTerburuk.take(10))
          {
            ...row,
            for (final key in ['hargaJual', 'hargaPokok', 'diskon', 'omzet', 'modal', 'laba']) key: rupiahJsonNum(row[key] as num),
          },
      ],
      'saran': saran,
    },
    'labaPerKategori': [
      for (final entry in (perKategori.entries.toList()..sort((a, b) => b.value.laba.compareTo(a.value.laba))))
        {'categoryName': entry.key, 'omzet': rupiahJsonNum(entry.value.omzet), 'laba': rupiahJsonNum(entry.value.laba)},
    ],
    'labaPerHari': [
      for (final entry in (perHari.entries.toList()..sort((a, b) => a.key.compareTo(b.key))))
        {'tanggal': entry.key, 'omzet': rupiahJsonNum(entry.value.omzet), 'laba': rupiahJsonNum(entry.value.laba)},
    ],
    'labaPerSatuan': [
      for (final row in labaPerSatuan)
        {'satuan': row.satuan, 'qtyTerjual': row.qty, 'omzet': rupiahJsonNum(row.omzet), 'laba': rupiahJsonNum(row.laba), 'marginPersen': row.margin},
    ],
    'produkTerlaris': [
      for (final row in produkTerlaris.take(5)) {'namaItem': row.namaItem, 'qtyTerjual': row.agg.qty, 'totalPenjualan': rupiahJsonNum(row.agg.omzet)},
    ],
    'pembelianPerSupplier': [
      for (final row in db.select(
        "SELECT coalesce(s.nama, 'Tanpa Supplier') AS supplier_name, coalesce(sum(pu.total), 0) AS total FROM purchases pu "
        'LEFT JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.tanggal >= ? AND pu.tanggal <= ? GROUP BY pu.supplier_id ORDER BY total DESC',
        [from, to],
      ))
        {'supplierName': row['supplier_name'], 'totalPembelian': rupiahJson(row['total'] as int)},
    ],
    'piutangPerPelanggan': [
      for (final row in piutangPerPelanggan)
        {
          'customerId': row['customer_id'],
          'namaPelanggan': row['nama_pelanggan'],
          'telepon': row['telepon'],
          'totalPiutang': rupiahJson(row['total_piutang'] as int),
          'jumlahBon': row['jumlah_bon'],
        },
    ],
    'stockValue': getStockValue(db),
    'salesHistory': [
      for (final row in db.select(
        'SELECT id, created_at, nama_pelanggan, metode_pembayaran, status, total, dibayar FROM sales WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC',
        [toEpochSeconds(start), toEpochSeconds(end)],
      ))
        {
          'id': row['id'],
          'createdAt': fromEpochSeconds(row['created_at'] as int).toIso8601String(),
          'namaPelanggan': row['nama_pelanggan'],
          'metodePembayaran': row['metode_pembayaran'],
          'status': row['status'],
          'total': rupiahJson(row['total'] as int),
          'dibayar': rupiahJson(row['dibayar'] as int),
        },
    ],
  };
}

List<Map<String, Object?>> _unikProduk(Iterable<({int productId, String namaItem, String satuan})> rows) {
  final seen = <String, Map<String, Object?>>{};

  for (final row in rows) {
    seen['${row.productId}:${row.satuan}'] = {'productId': row.productId, 'namaItem': row.namaItem, 'satuan': row.satuan};
  }

  return seen.values.toList();
}

/// Turns the period's own figures into advice; every entry has to be earned by the numbers.
/// Money in `nilai` goes out in rupiah, the wording is the client's job.
List<Map<String, Object?>> _susunSaran(
  Db db, {
  required int penjualanKotor,
  required num modal,
  required num labaKotor,
  required int totalDiskon,
  required List<Map<String, Object?>> barisRugi,
  required List<({String satuan, num qty, num omzet, num laba, double margin})> labaPerSatuan,
  required List<({int productId, String namaItem, String satuan})> barisTerjual,
  required List<int> saleIdsDiskon,
}) {
  final saran = <Map<String, Object?>>[];
  final marginMinimal = db.scalar<int>('SELECT margin_minimal_persen FROM store_settings LIMIT 1') ?? 10;
  final currentUnits = {for (final row in db.select('SELECT id, harga_jual, harga_pokok FROM product_units')) row['id'] as int: row};

  // priced under cost: the master price itself is wrong - the one cause fixable outright
  final rugiKarenaHarga = barisRugi.where((row) => (row['hargaJual'] as int) < (row['hargaPokok'] as int)).toList();

  if (rugiKarenaHarga.isNotEmpty) {
    final namaUnik = rugiKarenaHarga.map((row) => '${row['namaItem']} (${row['satuan']})').toSet().toList();
    final diperbaiki = rugiKarenaHarga.every((row) {
      // a deleted unit must not be mistaken for the product's base unit
      final unit = currentUnits[row['productUnitId']];

      if (unit == null) {
        return false;
      }

      final jual = unit['harga_jual'] as int;
      final pokok = unit['harga_pokok'] as int;

      return jual > 0 && pokok > 0 && jual * (100 - marginMinimal) >= pokok * 100;
    });

    saran.add({
      'kode': 'harga_di_bawah_modal',
      'status': diperbaiki ? 'diperbaiki' : 'aktif',
      'jumlah': namaUnik.length,
      'nilai': rupiahJsonNum(rugiKarenaHarga.fold<num>(0, (sum, row) => sum + (row['laba'] as num))),
      'persen': 0,
      'contoh': namaUnik.take(3).toList(),
      'produk': _unikProduk(rugiKarenaHarga.map((row) => (productId: row['productId'] as int, namaItem: row['namaItem'] as String, satuan: row['satuan'] as String))),
      'saleIds': rugiKarenaHarga.map((row) => row['saleId'] as int).toSet().toList(),
    });
  }

  // the discount ate most of what the goods would otherwise have earned
  final labaSebelumDiskon = penjualanKotor - modal;

  if (totalDiskon > 0 && labaSebelumDiskon > 0 && labaKotor < labaSebelumDiskon * _ambangSisaMargin) {
    saran.add({
      'kode': 'diskon_memakan_margin',
      'status': 'riwayat',
      'jumlah': 0,
      'nilai': rupiahJson(totalDiskon),
      // the rate the goods can actually carry - a discount above this sells at a loss
      'persen': labaSebelumDiskon / penjualanKotor * 100,
      'contoh': <String>[],
      'produk': <Object>[],
      'saleIds': saleIdsDiskon,
    });
  }

  // the thinnest satuan sold, usually a grosir packaging whose real cost was never recorded
  final terjual = labaPerSatuan.where((row) => row.omzet > 0).toList()..sort((a, b) => a.margin.compareTo(b.margin));

  if (terjual.isNotEmpty && terjual.first.margin < _ambangMarginSatuan) {
    final tertipis = terjual.first;

    saran.add({
      'kode': 'satuan_margin_tipis',
      'status': 'riwayat',
      'jumlah': tertipis.qty,
      'nilai': rupiahJsonNum(tertipis.laba),
      'persen': tertipis.margin,
      'contoh': [tertipis.satuan],
      'produk': _unikProduk(barisTerjual.where((row) => row.satuan == tertipis.satuan)),
      'saleIds': <int>[],
    });
  }

  // what is still mispriced in the catalog: margin below m percent is
  // `jual * (100 - m) < pokok * 100`, with no division to round away
  final diBawahMargin = db.select(
    'SELECT p.id AS product_id, p.nama_item, u.code AS satuan FROM product_units pu JOIN products p ON p.id = pu.product_id '
    'JOIN units u ON u.id = pu.unit_id WHERE pu.harga_jual > 0 AND pu.harga_pokok > 0 AND pu.harga_jual * ? < pu.harga_pokok * 100',
    [100 - marginMinimal],
  );

  if (diBawahMargin.isNotEmpty) {
    saran.add({
      'kode': 'katalog_di_bawah_margin',
      'status': 'aktif',
      'jumlah': diBawahMargin.length,
      'nilai': 0,
      'persen': marginMinimal,
      'contoh': <String>[],
      'produk': _unikProduk(diBawahMargin.map((row) => (productId: row['product_id'] as int, namaItem: row['nama_item'] as String, satuan: row['satuan'] as String))),
      'saleIds': <int>[],
    });
  }

  return saran;
}

Map<String, Object?> getStockValue(Db db) {
  final rows = db.select(
    'SELECT p.nama_item, p.kode_item, u.code AS satuan, p.stok, p.harga_pokok FROM products p '
    'LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base_unit = 1 LEFT JOIN units u ON u.id = pu.unit_id '
    'WHERE p.is_active = 1 AND p.stok > 0',
  );
  final produk = [
    for (final row in rows) (row: row, nilai: (row['stok'] as num) * (row['harga_pokok'] as int)),
  ]..sort((a, b) => b.nilai.compareTo(a.nilai));

  return {
    'totalNilai': rupiahJsonNum(produk.fold<num>(0, (sum, entry) => sum + entry.nilai)),
    'produk': [
      for (final entry in produk)
        {
          'namaItem': entry.row['nama_item'],
          'kodeItem': entry.row['kode_item'],
          'satuan': entry.row['satuan'] ?? '',
          'stok': entry.row['stok'],
          'hargaPokok': rupiahJson(entry.row['harga_pokok'] as int),
          'nilai': rupiahJsonNum(entry.nilai),
        },
    ],
  };
}

const _lowStockThreshold = 5;

/// Today's rekap figures plus what needs attention: low stock and the latest sales.
Map<String, Object?> getDashboard(Db db) {
  final today = tanggalLokal(DateTime.now());
  final rekap = getRekap(db, from: today, to: today);
  final latest = db.select('SELECT * FROM sales ORDER BY created_at DESC LIMIT 5');
  final ids = [for (final sale in latest) sale['id']];
  final items = ids.isEmpty
      ? <Row>[]
      : db.select(
          'SELECT si.sale_id, si.qty, p.nama_item FROM sale_items si JOIN products p ON p.id = si.product_id '
          'WHERE si.sale_id IN (${List.filled(ids.length, '?').join(', ')}) ORDER BY si.id',
          ids,
        );

  return {
    'summary': rekap['summary'],
    'stokMenipis': [
      for (final row in db.select(
        'SELECT p.id, p.kode_item, p.nama_item, u.code AS satuan, p.stok FROM products p '
        'LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base_unit = 1 LEFT JOIN units u ON u.id = pu.unit_id '
        'WHERE p.is_active = 1 AND p.stok <= ? ORDER BY p.stok LIMIT 10',
        [_lowStockThreshold],
      ))
        {'id': row['id'], 'kodeItem': row['kode_item'], 'namaItem': row['nama_item'], 'satuan': row['satuan'] ?? '', 'stok': row['stok']},
    ],
    'produkTerlarisHariIni': rekap['produkTerlaris'],
    'transaksiTerbaru': [
      for (final sale in latest)
        {
          'id': sale['id'],
          'namaPelanggan': sale['nama_pelanggan'],
          'metodePembayaran': sale['metode_pembayaran'],
          'status': sale['status'],
          'total': rupiahJson(sale['total'] as int),
          'dibayar': rupiahJson(sale['dibayar'] as int),
          'createdAt': fromEpochSeconds(sale['created_at'] as int).toIso8601String(),
          'itemSummary': items.where((i) => i['sale_id'] == sale['id']).map((i) => '${i['nama_item']} x${i['qty']}').join(', '),
        },
    ],
  };
}
