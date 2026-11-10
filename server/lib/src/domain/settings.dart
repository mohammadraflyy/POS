import '../core/errors.dart';
import '../db/db.dart';

/// Largest logo accepted; a shop mark needs no more than a few hundred kilobytes.
const maxLogoBytes = 2 * 1024 * 1024;

/// The stored logo, or null when the shop uses the default mark.
({String mime, List<int> bytes, int updatedAt})? getStoreLogo(Db db) {
  final row = db.first('SELECT mime, data, updated_at FROM store_logo WHERE id = 1');
  if (row == null) return null;

  return (mime: row['mime'] as String, bytes: row['data'] as List<int>, updatedAt: row['updated_at'] as int);
}

/// Replaces the logo. Only PNG, JPEG, and WebP are taken, recognised by their bytes rather
/// than a name the client sends.
void saveStoreLogo(Db db, List<int> bytes) {
  if (bytes.isEmpty) {
    throw BusinessException('File logo kosong.');
  }

  if (bytes.length > maxLogoBytes) {
    throw BusinessException('Logo terlalu besar (maksimal 2 MB).');
  }

  final mime = logoMimeType(bytes);
  if (mime == null) {
    throw BusinessException('Logo harus berupa gambar PNG, JPG, atau WebP.');
  }

  db.execute(
    'INSERT INTO store_logo (id, mime, data, updated_at) VALUES (1, ?, ?, ?) '
    'ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at',
    [mime, bytes, DateTime.now().millisecondsSinceEpoch],
  );
}

void deleteStoreLogo(Db db) => db.execute('DELETE FROM store_logo WHERE id = 1');

String? logoMimeType(List<int> b) {
  bool starts(List<int> sig, [int offset = 0]) {
    if (b.length < offset + sig.length) return false;
    for (var i = 0; i < sig.length; i++) {
      if (b[offset + i] != sig[i]) return false;
    }
    return true;
  }

  if (starts(const [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
  if (starts(const [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (starts(const [0x52, 0x49, 0x46, 0x46]) && starts(const [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

Map<String, Object?> getStoreSettings(Db db) {
  final row = db.first('SELECT * FROM store_settings ORDER BY id LIMIT 1');
  final logo = db.first('SELECT updated_at FROM store_logo WHERE id = 1');

  return {
    // changes whenever the logo does, so clients know when to fetch it again
    'logoVersion': logo?['updated_at'],
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
