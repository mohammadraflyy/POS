/// Audited corrections to the cost (HPP) a past sale line was booked at - for a sale rung
/// up before the product's real cost was ever entered. Preview first, then apply with the
/// preview's token, so nothing that changed in between is silently overwritten.
library;

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

import '../core/errors.dart';
import '../core/money.dart';
import '../db/db.dart';
import 'auth.dart';

class CostCorrectionRequest {
  const CostCorrectionRequest({required this.saleItemId, required this.scope, required this.from, required this.to, required this.hargaPokok});

  final int saleItemId;

  /// `item` corrects that one line; `period` every matching line of the product in range.
  final String scope;
  final String from;
  final String to;

  /// Rupiah, as typed.
  final num hargaPokok;

  Map<String, Object?> toJson() => {'saleItemId': saleItemId, 'scope': scope, 'from': from, 'to': to, 'hargaPokok': hargaPokok};
}

DateTime _dateBound(String value, {required bool end}) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(value);
  final date = match == null ? null : DateTime(int.parse(match[1]!), int.parse(match[2]!), int.parse(match[3]!));

  if (date == null || date.month != int.parse(match![2]!) || date.day != int.parse(match[3]!)) {
    throw BusinessException('Tanggal koreksi tidak valid.');
  }

  return end ? DateTime(date.year, date.month, date.day, 23, 59, 59, 999) : date;
}

({Map<String, Object?> preview, List<Row> targets, int cost}) _prepare(Db db, CostCorrectionRequest input) {
  if (input.saleItemId < 1) {
    throw BusinessException('Item transaksi tidak valid.');
  }

  if (input.scope != 'item' && input.scope != 'period') {
    throw BusinessException('Cakupan koreksi tidak valid.');
  }

  if (!input.hargaPokok.isFinite || input.hargaPokok < 0) {
    throw BusinessException('HPP harus berupa angka nol atau lebih.');
  }

  final cost = toCents(input.hargaPokok);
  final source = db.first('SELECT * FROM sale_items WHERE id = ?', [input.saleItemId]);

  if (source == null) {
    throw BusinessException('Item transaksi tidak ditemukan. Muat ulang Rekap.');
  }

  final namaItem = db.scalar<String>('SELECT nama_item FROM products WHERE id = ?', [source['product_id']])!;

  if (db.scalar<String>('SELECT status FROM sales WHERE id = ?', [source['sale_id']]) != 'selesai') {
    throw BusinessException('Transaksi yang dibatalkan tidak bisa dikoreksi.');
  }

  var candidates = [source];

  if (input.scope == 'period') {
    final from = _dateBound(input.from, end: false);
    final to = _dateBound(input.to, end: true);

    if (from.isAfter(to)) {
      throw BusinessException('Tanggal awal harus sebelum atau sama dengan tanggal akhir.');
    }

    candidates = db
        .select(
          "SELECT si.* FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = ? AND s.status = 'selesai' "
          'AND s.created_at >= ? AND s.created_at <= ? ORDER BY si.id',
          [source['product_id'], toEpochSeconds(from), toEpochSeconds(to)],
        )
        // a unit's conversion may have changed: only correct matching historical units
        .where((item) => item['product_unit_id'] == source['product_unit_id'] && item['satuan'] == source['satuan'] && item['konversi'] == source['konversi'])
        .toList();
  }

  final targets = candidates.where((item) => item['harga_pokok'] != cost).toList();

  if (targets.isEmpty) {
    throw BusinessException('Tidak ada HPP yang perlu diubah untuk cakupan ini.');
  }

  if (targets.length > 500) {
    throw BusinessException('Maksimal 500 baris per koreksi. Persempit rentang tanggal.');
  }

  final saleIds = targets.map((item) => item['sale_id']).toSet().toList();
  final placeholders = List.filled(saleIds.length, '?').join(', ');
  final saleRows = db.select('SELECT * FROM sales WHERE id IN ($placeholders) ORDER BY id', saleIds);
  final allItems = db.select('SELECT * FROM sale_items WHERE sale_id IN ($placeholders) ORDER BY sale_id, id', saleIds);
  final netByItem = <int, int>{};

  // the same pro-rata bill-discount split rekap uses, so the margins shown here agree with it
  for (final sale in saleRows) {
    final items = allItems.where((item) => item['sale_id'] == sale['id']);
    var remainingDiscount = sale['diskon'] as int;
    var remainingSubtotal = items.fold<int>(0, (sum, item) => sum + (item['subtotal'] as int));

    for (final item in items) {
      final subtotal = item['subtotal'] as int;
      final discount = remainingSubtotal > 0 ? (remainingDiscount * subtotal / remainingSubtotal).round() : 0;
      remainingDiscount -= discount;
      remainingSubtotal -= subtotal;
      netByItem[item['id'] as int] = subtotal - discount;
    }
  }

  // stale previews are rejected - including price or discount edits and new matching sales
  final token = sha256.convert(utf8.encode(jsonEncode({'input': input.toJson(), 'targets': targets, 'saleRows': saleRows, 'allItems': allItems}))).toString();
  final rows = [
    for (final item in targets)
      () {
        final omzet = netByItem[item['id']]!;
        final qty = item['qty'] as num;

        return {
          'saleItemId': item['id'],
          'saleId': item['sale_id'],
          'tanggal': fromEpochSeconds(saleRows.firstWhere((sale) => sale['id'] == item['sale_id'])['created_at'] as int).toIso8601String(),
          'qty': qty,
          'hargaPokokLama': rupiahJson(item['harga_pokok'] as int),
          'omzet': rupiahJson(omzet),
          'labaLama': rupiahJsonNum(omzet - qty * (item['harga_pokok'] as int)),
          'labaBaru': rupiahJsonNum(omzet - qty * cost),
        };
      }(),
  ];

  return (
    preview: {
      'token': token,
      'namaItem': namaItem,
      'satuan': source['satuan'] ?? 'Satuan transaksi',
      'hargaPokok': rupiahJson(cost),
      'rows': rows,
      'labaLama': rows.fold<num>(0, (sum, row) => sum + (row['labaLama'] as num)),
      'labaBaru': rows.fold<num>(0, (sum, row) => sum + (row['labaBaru'] as num)),
    },
    targets: targets,
    cost: cost,
  );
}

Map<String, Object?> previewCostCorrection(Db db, AuthUser user, CostCorrectionRequest input) {
  assertAdmin(user);

  return _prepare(db, input).preview;
}

String _uuid() {
  final random = Random.secure();
  final bytes = List.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

int applyCostCorrection(Db db, AuthUser user, CostCorrectionRequest input, {required String token, required String alasan}) {
  final admin = assertAdmin(user);
  final reason = alasan.trim();

  if (reason.isEmpty || reason.length > 1000) {
    throw BusinessException('Alasan koreksi wajib diisi, maksimal 1.000 karakter.');
  }

  return db.transaction(() {
    final prepared = _prepare(db, input);

    if (token != prepared.preview['token']) {
      throw BusinessException('Data sudah berubah. Tampilkan pratinjau lagi sebelum menyimpan.');
    }

    final now = nowSeconds();
    final batchId = _uuid();

    for (final item in prepared.targets) {
      db.insert(
        'INSERT INTO sale_cost_corrections (batch_id, sale_id, sale_item_id, product_id, nama_item, satuan, qty, harga_pokok_lama, harga_pokok_baru, '
        'user_id, admin_name, alasan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          batchId,
          item['sale_id'],
          item['id'],
          item['product_id'],
          prepared.preview['namaItem'],
          prepared.preview['satuan'],
          item['qty'],
          item['harga_pokok'],
          prepared.cost,
          admin.id,
          admin.name,
          reason,
          now,
        ],
      );
      db.execute('UPDATE sale_items SET harga_pokok = ?, updated_at = ? WHERE id = ?', [prepared.cost, now, item['id']]);
    }

    return prepared.targets.length;
  });
}

List<Map<String, Object?>> listCostCorrections(Db db, AuthUser user) {
  assertAdmin(user);

  return [
    for (final row in db.select('SELECT * FROM sale_cost_corrections ORDER BY id DESC LIMIT 200'))
      {
        'id': row['id'],
        'batchId': row['batch_id'],
        'saleId': row['sale_id'],
        'namaItem': row['nama_item'],
        'satuan': row['satuan'],
        'qty': row['qty'],
        'hargaPokokLama': rupiahJson(row['harga_pokok_lama'] as int),
        'hargaPokokBaru': rupiahJson(row['harga_pokok_baru'] as int),
        'alasan': row['alasan'],
        'adminName': row['admin_name'],
        'createdAt': fromEpochSeconds(row['created_at'] as int).toIso8601String(),
      },
  ];
}
