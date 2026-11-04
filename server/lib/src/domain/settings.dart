import '../core/errors.dart';
import '../db/db.dart';

Map<String, Object?> getStoreSettings(Db db) {
  final row = db.first('SELECT * FROM store_settings ORDER BY id LIMIT 1');

  return {
    'namaToko': row?['nama_toko'] ?? 'Toko',
    'alamat': row?['alamat'],
    'telepon': row?['telepon'],
    'pesanFooter': row?['pesan_footer'],
    'printerName': row?['printer_name'],
    'receiptWidth': row?['receipt_width'] ?? '58mm',
    'marginMinimalPersen': row?['margin_minimal_persen'] ?? 10,
  };
}

/// [marginMinimalPersen] null keeps the stored value - callers that only edit the receipt
/// details must not reset it.
void updateStoreSettings(
  Db db, {
  required String namaToko,
  String? alamat,
  String? telepon,
  String? pesanFooter,
  String? printerName,
  required String receiptWidth,
  num? marginMinimalPersen,
}) {
  if (namaToko.trim().isEmpty) {
    throw BusinessException('Nama toko wajib diisi.');
  }

  if (namaToko.length > 255) {
    throw BusinessException('Nama toko maksimal 255 karakter.');
  }

  if ((alamat?.length ?? 0) > 255) {
    throw BusinessException('Alamat maksimal 255 karakter.');
  }

  if ((telepon?.length ?? 0) > 50) {
    throw BusinessException('Telepon maksimal 50 karakter.');
  }

  if ((pesanFooter?.length ?? 0) > 255) {
    throw BusinessException('Pesan footer maksimal 255 karakter.');
  }

  if (receiptWidth != '58mm' && receiptWidth != '80mm') {
    throw BusinessException('Lebar kertas tidak valid.');
  }

  // 90% of the selling price as cost leaves a 10x markup; anything above is a typo
  if (marginMinimalPersen != null && (!marginMinimalPersen.isFinite || marginMinimalPersen < 0 || marginMinimalPersen > 90)) {
    throw BusinessException('Margin minimal harus antara 0 dan 90 persen.');
  }

  final existing = db.first('SELECT id, margin_minimal_persen FROM store_settings ORDER BY id LIMIT 1');
  final margin = (marginMinimalPersen ?? existing?['margin_minimal_persen'] as int? ?? 10).round();
  final now = nowSeconds();

  if (existing != null) {
    db.execute(
      'UPDATE store_settings SET nama_toko = ?, alamat = ?, telepon = ?, pesan_footer = ?, printer_name = ?, receipt_width = ?, '
      'margin_minimal_persen = ?, updated_at = ? WHERE id = ?',
      [namaToko, alamat, telepon, pesanFooter, printerName, receiptWidth, margin, now, existing['id']],
    );
  } else {
    db.insert(
      'INSERT INTO store_settings (nama_toko, alamat, telepon, pesan_footer, printer_name, receipt_width, margin_minimal_persen, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [namaToko, alamat, telepon, pesanFooter, printerName, receiptWidth, margin, now, now],
    );
  }
}
