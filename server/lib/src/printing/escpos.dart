import 'dart:convert';

import '../core/qty.dart';

enum PaperWidth {
  mm58('58mm', 32),
  mm80('80mm', 48);

  const PaperWidth(this.label, this.chars);

  final String label;
  final int chars;

  static PaperWidth parse(Object? value) => value == '80mm' ? mm80 : mm58;
}

class ReceiptItem {
  const ReceiptItem({required this.namaItem, required this.qty, required this.satuan, required this.hargaJual, required this.diskon, required this.subtotal});

  final String namaItem;
  final num qty;
  final String? satuan;

  /// Rupiah.
  final num hargaJual;

  /// Rupiah, already taken off [subtotal].
  final num diskon;
  final num subtotal;
}

class ReceiptSale {
  const ReceiptSale({
    required this.saleId,
    required this.diskon,
    required this.total,
    required this.dibayar,
    required this.metodePembayaran,
    required this.namaPelanggan,
    required this.createdAt,
    required this.kasirName,
    required this.items,
    this.biayaLain = 0,
    this.keterangan,
  });

  final int saleId;

  /// Rupiah; bill-wide, already taken off [total].
  final num diskon;
  final num total;
  final num dibayar;
  final num biayaLain;
  final String metodePembayaran;
  final String? namaPelanggan;
  final DateTime createdAt;
  final String? kasirName;
  final String? keterangan;
  final List<ReceiptItem> items;
}

class StoreInfo {
  const StoreInfo({required this.namaToko, this.alamat, this.telepon, this.pesanFooter});

  final String namaToko;
  final String? alamat;
  final String? telepon;
  final String? pesanFooter;
}

const _esc = 0x1b;
const _gs = 0x1d;

/// `left` and `right` at opposite ends of a [width]-character line, `left` truncated if needed.
String padLine(String left, String right, int width) {
  final gap = width - left.length - right.length;

  if (gap < 1) {
    final maxLeft = (width - right.length - 1).clamp(0, left.length);

    return '${left.substring(0, maxLeft)} $right';
  }

  return '$left${' ' * gap}$right';
}

String _group(String digits) {
  final buffer = StringBuffer();

  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) {
      buffer.write('.');
    }

    buffer.write(digits[i]);
  }

  return buffer.toString();
}

/// Indonesian notation: dots group thousands, a comma marks decimals, up to [maxDecimals].
String formatAngka(num value, {int maxDecimals = 0}) {
  final negative = value < 0;
  final fixed = value.abs().toStringAsFixed(maxDecimals);
  final parts = fixed.split('.');
  var decimals = parts.length > 1 ? parts[1].replaceFirst(RegExp(r'0+$'), '') : '';
  final whole = _group(parts[0]);

  decimals = decimals.isEmpty ? '' : ',$decimals';

  return '${negative ? '-' : ''}$whole$decimals';
}

/// `Rp 25.000`, with cents shown only when there are any.
String formatRupiah(num value) => value < 0 ? '-Rp ${formatAngka(-value, maxDecimals: 2)}' : 'Rp ${formatAngka(value, maxDecimals: 2)}';

String formatQty(num value) => formatAngka(value, maxDecimals: qtyDecimals);

/// `13/10/2026, 19.09.00`, the id-ID short date-time the desktop app prints.
String formatTanggal(DateTime time) {
  String two(int n) => n.toString().padLeft(2, '0');

  return '${time.day}/${time.month}/${time.year}, ${two(time.hour)}.${two(time.minute)}.${two(time.second)}';
}

/// Printers here are plain ASCII; anything else becomes `?` rather than garbage bytes.
List<int> _line(String text) => ascii.encode('${text.replaceAll(RegExp(r'[^\x20-\x7e]'), '?')}\n');

List<int> buildReceiptEscPos(ReceiptSale sale, StoreInfo store, PaperWidth paper) {
  final width = paper.chars;
  final dash = '-' * width;
  final out = <int>[_esc, 0x40];

  void align(int mode) => out.addAll([_esc, 0x61, mode]);
  void bold(bool on) => out.addAll([_esc, 0x45, on ? 1 : 0]);
  void line(String text) => out.addAll(_line(text));

  align(1);
  bold(true);
  line(store.namaToko);
  bold(false);

  if (store.alamat != null && store.alamat!.isNotEmpty) {
    line(store.alamat!);
  }

  if (store.telepon != null && store.telepon!.isNotEmpty) {
    line(store.telepon!);
  }

  align(0);
  line(dash);
  line(padLine('Struk #${sale.saleId}', formatTanggal(sale.createdAt), width));

  if (sale.kasirName != null) {
    line(padLine('Kasir', sale.kasirName!, width));
  }

  // printed for every method: a tunai customer may give a name too
  if (sale.namaPelanggan != null && sale.namaPelanggan!.isNotEmpty) {
    line(padLine('Pelanggan', sale.namaPelanggan!, width));
  }

  line(dash);

  num subtotalBarang = 0;

  for (final item in sale.items) {
    line(item.namaItem);

    final qtyLabel = '${formatQty(item.qty)} ${item.satuan ?? ''} x ${formatRupiah(item.hargaJual)}'.replaceAll(RegExp(r'\s+'), ' ').trim();
    subtotalBarang += item.subtotal;

    if (item.diskon > 0) {
      // the undiscounted price first, then the discount back, so it matches the shelf
      line(padLine(qtyLabel, formatRupiah(item.subtotal + item.diskon), width));
      line(padLine('  Diskon', '-${formatRupiah(item.diskon)}', width));
    } else {
      line(padLine(qtyLabel, formatRupiah(item.subtotal), width));
    }
  }

  line(dash);

  if (sale.diskon > 0) {
    line(padLine('Subtotal', formatRupiah(subtotalBarang), width));
    line(padLine('Diskon', '-${formatRupiah(sale.diskon)}', width));
  }

  if (sale.biayaLain > 0) {
    line(padLine('Lain-lain', formatRupiah(sale.biayaLain), width));
  }

  final keterangan = sale.keterangan?.trim() ?? '';

  if (keterangan.isNotEmpty) {
    line('Keterangan:');

    // wrapped to the paper width, with printer control characters taken out
    for (final paragraph in keterangan.replaceAll(RegExp(r'[\x00-\x09\x0b-\x1f\x7f]'), ' ').split(RegExp(r'\r?\n'))) {
      for (var offset = 0; offset < paragraph.length; offset += width) {
        line(paragraph.substring(offset, (offset + width).clamp(0, paragraph.length)));
      }
    }

    line(dash);
  }

  bold(true);
  line(padLine('TOTAL', formatRupiah(sale.total), width));
  bold(false);

  if (sale.metodePembayaran == 'qris' || sale.metodePembayaran == 'transfer') {
    line(padLine(sale.metodePembayaran == 'qris' ? 'QRIS' : 'Transfer', formatRupiah(sale.total), width));
  } else if (sale.metodePembayaran == 'tunai') {
    final kembali = sale.dibayar - sale.total;
    line(padLine('Tunai', formatRupiah(sale.dibayar), width));
    line(padLine('Kembali', formatRupiah(kembali < 0 ? 0 : kembali), width));
  } else {
    // the name already has its own line, so this one carries the debt
    line(padLine('Bon', formatRupiah(sale.total - sale.dibayar), width));
  }

  if (store.pesanFooter != null && store.pesanFooter!.isNotEmpty) {
    line(dash);
    align(1);
    line(store.pesanFooter!);
  }

  out.addAll([_esc, 0x64, 3, _gs, 0x56, 0x00]);

  return out;
}

/// The fixed receipt the Settings page's Test Print sends.
ReceiptSale sampleReceipt() => ReceiptSale(
      saleId: 0,
      diskon: 0,
      total: 25000,
      dibayar: 30000,
      metodePembayaran: 'tunai',
      namaPelanggan: null,
      createdAt: DateTime.now(),
      kasirName: 'Test',
      items: const [
        ReceiptItem(namaItem: 'Contoh Produk A', qty: 2, satuan: 'PCS', hargaJual: 10000, diskon: 0, subtotal: 20000),
        ReceiptItem(namaItem: 'Contoh Produk B', qty: 1, satuan: 'PCS', hargaJual: 5000, diskon: 0, subtotal: 5000),
      ],
    );
