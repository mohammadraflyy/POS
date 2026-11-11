import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/format.dart';
import '../models/live_models.dart';

/// Right-pads/truncates so `left` and `right` sit at opposite ends of a `width`-character line,
/// exactly matching ESC/POS printer behavior on desktop-node and server.
String padReceiptLine(String left, String right, int width) {
  final gap = width - left.length - right.length;
  if (gap < 1) {
    final maxLeft = (width - right.length - 1).clamp(0, width);
    return '${left.substring(0, maxLeft)} $right';
  }
  return '$left${' ' * gap}$right';
}

/// A faithful thermal receipt paper widget supporting both 58 mm (32 columns)
/// and 80 mm (48 columns) paper formats with authentic typography, character wrapping,
/// and live toggling.
class ReceiptPaperPreview extends StatefulWidget {
  const ReceiptPaperPreview({
    super.key,
    required this.storeName,
    this.address,
    this.phone,
    this.footer,
    this.initialIs80mm = false,
    this.onWidthChanged,
    this.logoBytes,
    this.saleId,
    this.date,
    this.cashier,
    this.customer,
    this.items,
    this.subtotal,
    this.discount,
    this.charge,
    this.total,
    this.method = 'tunai',
    this.paid,
    this.change,
    this.remaining,
    this.note,
    this.allowToggle = true,
  });

  final String storeName;
  final String? address;
  final String? phone;
  final String? footer;
  final bool initialIs80mm;
  final ValueChanged<bool>? onWidthChanged;
  final Uint8List? logoBytes;
  final int? saleId;
  final DateTime? date;
  final String? cashier;
  final String? customer;
  final List<Map<String, dynamic>>? items;
  final num? subtotal;
  final num? discount;
  final num? charge;
  final num? total;
  final String method;
  final num? paid;
  final num? change;
  final num? remaining;
  final String? note;
  final bool allowToggle;

  @override
  State<ReceiptPaperPreview> createState() => _ReceiptPaperPreviewState();
}

class _ReceiptPaperPreviewState extends State<ReceiptPaperPreview> {
  late bool _is80mm;

  @override
  void initState() {
    super.initState();
    _is80mm = widget.initialIs80mm;
  }

  @override
  void didUpdateWidget(covariant ReceiptPaperPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialIs80mm != oldWidget.initialIs80mm) {
      _is80mm = widget.initialIs80mm;
    }
  }

  void _toggleWidth(bool is80) {
    setState(() => _is80mm = is80);
    widget.onWidthChanged?.call(is80);
  }

  @override
  Widget build(BuildContext context) {
    final chars = _is80mm ? 48 : 32;
    final paperWidth = _is80mm ? 390.0 : 270.0;
    final divider = '-' * chars;

    const mono = TextStyle(
      fontFamily: monoFamily,
      fontFamilyFallback: ['monospace'],
      fontSize: 11,
      color: Color(0xFF1E293B),
      height: 1.3,
      letterSpacing: 0.2,
    );
    const monoBold = TextStyle(
      fontFamily: monoFamily,
      fontFamilyFallback: ['monospace'],
      fontSize: 11.5,
      fontWeight: FontWeight.bold,
      color: Colors.black,
      height: 1.3,
      letterSpacing: 0.2,
    );

    final store = widget.storeName.trim().isEmpty ? 'NAMA TOKO' : widget.storeName.trim();
    final addr = widget.address?.trim() ?? '';
    final telp = widget.phone?.trim() ?? '';
    final foot = widget.footer?.trim() ?? 'Terima kasih atas kunjungan Anda';
    final notaNo = widget.saleId != null ? '#${widget.saleId}' : '#1024';
    final now = widget.date ?? DateTime.now();
    final dateStr = '${now.day.toString().padLeft(2, '0')}/${now.month.toString().padLeft(2, '0')}/${now.year.toString().substring(2)} ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final kasir = widget.cashier ?? 'Admin';
    final pelanggan = widget.customer?.trim();

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        if (widget.allowToggle) ...[
          Container(
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(Corners.control),
              border: Border.all(color: lineColor),
            ),
            padding: const EdgeInsets.all(3),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _WidthButton(
                  label: '58 mm  ·  32 Kolom',
                  selected: !_is80mm,
                  onTap: () => _toggleWidth(false),
                ),
                const SizedBox(width: 4),
                _WidthButton(
                  label: '80 mm  ·  48 Kolom',
                  selected: _is80mm,
                  onTap: () => _toggleWidth(true),
                ),
              ],
            ),
          ),
        ],
        // The Paper Card
        Container(
          width: paperWidth,
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: EdgeInsets.symmetric(horizontal: _is80mm ? 18 : 14, vertical: 16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: const Color(0xFFCBD5E1), width: 1.2),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Logo
              if (widget.logoBytes != null) ...[
                Center(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Image.memory(widget.logoBytes!, width: _is80mm ? 52 : 44, height: _is80mm ? 52 : 44, fit: BoxFit.contain),
                  ),
                ),
                const SizedBox(height: 6),
              ],

              // Header
              Text(
                store.toUpperCase(),
                style: monoBold.copyWith(fontSize: _is80mm ? 13 : 12),
                textAlign: TextAlign.center,
              ),
              if (addr.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(addr, style: mono.copyWith(fontSize: 9.5), textAlign: TextAlign.center),
                ),
              if (telp.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 1),
                  child: Text('Telp: $telp', style: mono.copyWith(fontSize: 9.5), textAlign: TextAlign.center),
                ),

              // Divider
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(divider, style: mono.copyWith(color: const Color(0xFF94A3B8)), textAlign: TextAlign.center),
              ),

              // Transaction info
              Text(padReceiptLine(notaNo, dateStr, chars), style: mono),
              Text(padReceiptLine('Kasir', kasir, chars), style: mono),
              if (pelanggan != null && pelanggan.isNotEmpty)
                Text(padReceiptLine('Pelanggan', pelanggan, chars), style: mono),

              // Divider
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(divider, style: mono.copyWith(color: const Color(0xFF94A3B8)), textAlign: TextAlign.center),
              ),

              // 80mm Column Headers
              if (_is80mm) ...[
                Text(padReceiptLine('ITEM', 'QTY     HARGA      TOTAL', chars), style: monoBold.copyWith(fontSize: 10.5)),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(divider, style: mono.copyWith(color: const Color(0xFF94A3B8)), textAlign: TextAlign.center),
                ),
              ],

              // Items
              if (widget.items != null && widget.items!.isNotEmpty) ...[
                for (final item in widget.items!)
                  _buildItemRow(item, chars, _is80mm, mono, monoBold),
              ] else ...[
                // Default sample items for Settings preview
                _buildSampleItems(chars, _is80mm, mono, monoBold),
              ],

              // Divider
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(divider, style: mono.copyWith(color: const Color(0xFF94A3B8)), textAlign: TextAlign.center),
              ),

              // Summary
              _buildSummary(chars, _is80mm, mono, monoBold),

              // Note
              if (widget.note != null && widget.note!.trim().isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(divider, style: mono.copyWith(color: const Color(0xFF94A3B8)), textAlign: TextAlign.center),
                ),
                Text('Keterangan: ${widget.note!.trim()}', style: mono.copyWith(fontSize: 9.5)),
              ],

              // Divider
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(divider, style: mono.copyWith(color: const Color(0xFF94A3B8)), textAlign: TextAlign.center),
              ),

              // Footer
              if (foot.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  foot,
                  style: mono.copyWith(fontStyle: FontStyle.italic, fontSize: 10, color: const Color(0xFF475569)),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 2),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildItemRow(Map<String, dynamic> item, int chars, bool is80mm, TextStyle mono, TextStyle monoBold) {
    final name = (item['namaItem'] ?? item['productName'] ?? item['namaProduk'] ?? 'Barang').toString();
    final qtyVal = number(item['qty']) ?? 1;
    final qtyStr = quantityText(qtyVal);
    final unitStr = (item['namaSatuan'] ?? item['satuan'] ?? '').toString();
    final priceVal = number(item['hargaJual']) ?? 0;
    final discVal = number(item['diskon']) ?? 0;
    final subtotalVal = number(item['subtotal'] ?? item['total']) ?? ((priceVal * qtyVal) - discVal);

    if (is80mm) {
      final rightPart = '${qtyStr.padLeft(4)} ${rupiah(priceVal).padLeft(9)} ${rupiah(subtotalVal).padLeft(10)}';
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 1.5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(padReceiptLine(name, rightPart, chars), style: mono),
            if (discVal > 0)
              Text(padReceiptLine('  Diskon barang', '-${rupiah(discVal)}', chars), style: mono.copyWith(fontSize: 10, color: const Color(0xFF64748B))),
          ],
        ),
      );
    } else {
      final qtyLabel = '$qtyStr ${unitStr.isNotEmpty ? '$unitStr ' : ''}× ${rupiah(priceVal)}';
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(name, style: monoBold.copyWith(fontSize: 10.5), maxLines: 2, overflow: TextOverflow.ellipsis),
            Text(padReceiptLine(qtyLabel, rupiah(subtotalVal + discVal), chars), style: mono),
            if (discVal > 0)
              Text(padReceiptLine('  Diskon', '-${rupiah(discVal)}', chars), style: mono.copyWith(fontSize: 10, color: const Color(0xFF64748B))),
          ],
        ),
      );
    }
  }

  Widget _buildSampleItems(int chars, bool is80mm, TextStyle mono, TextStyle monoBold) {
    if (is80mm) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(padReceiptLine('Kopi Susu Gula Aren', '  1x     8.000      8.000', chars), style: mono),
          Text(padReceiptLine('Mie Instan Goreng Spesial', '  2x     3.500      7.000', chars), style: mono),
          Text(padReceiptLine('Minyak Goreng Sawit 1L', '  1x    18.000     18.000', chars), style: mono),
          Text(padReceiptLine('  Diskon barang', '-2.000', chars), style: mono.copyWith(fontSize: 10, color: const Color(0xFF64748B))),
        ],
      );
    } else {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Kopi Susu Gula Aren', style: monoBold.copyWith(fontSize: 10.5)),
          Text(padReceiptLine('1 × 8.000', '8.000', chars), style: mono),
          const SizedBox(height: 2),
          Text('Mie Instan Goreng Spesial', style: monoBold.copyWith(fontSize: 10.5)),
          Text(padReceiptLine('2 × 3.500', '7.000', chars), style: mono),
          const SizedBox(height: 2),
          Text('Minyak Goreng Sawit 1L', style: monoBold.copyWith(fontSize: 10.5)),
          Text(padReceiptLine('1 × 18.000', '18.000', chars), style: mono),
          Text(padReceiptLine('  Diskon', '-2.000', chars), style: mono.copyWith(fontSize: 10, color: const Color(0xFF64748B))),
        ],
      );
    }
  }

  Widget _buildSummary(int chars, bool is80mm, TextStyle mono, TextStyle monoBold) {
    final subtotalVal = widget.subtotal ?? 33000;
    final discountVal = widget.discount ?? 3000;
    final chargeVal = widget.charge ?? 0;
    final totalVal = widget.total ?? (subtotalVal - discountVal + chargeVal);
    final paidVal = widget.paid ?? 50000;
    final changeVal = widget.change ?? (paidVal - totalVal > 0 ? paidVal - totalVal : 0);
    final remainingVal = widget.remaining ?? 0;
    final methodStr = widget.method.toUpperCase();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (discountVal > 0) ...[
          Text(padReceiptLine('Subtotal', rupiah(subtotalVal), chars), style: mono),
          Text(padReceiptLine('Diskon nota', '-${rupiah(discountVal)}', chars), style: mono),
        ],
        if (chargeVal > 0)
          Text(padReceiptLine('Biaya lain', rupiah(chargeVal), chars), style: mono),
        Text(padReceiptLine('TOTAL', rupiah(totalVal), chars), style: monoBold),
        if (widget.method == 'tunai') ...[
          Text(padReceiptLine('Tunai', rupiah(paidVal), chars), style: mono),
          Text(padReceiptLine('Kembali', rupiah(changeVal), chars), style: mono),
        ] else if (widget.method == 'bon') ...[
          Text(padReceiptLine('Bon / Piutang', rupiah(paidVal), chars), style: mono),
          if (remainingVal > 0)
            Text(padReceiptLine('Sisa Bon', rupiah(remainingVal), chars), style: mono.copyWith(color: errorColor)),
        ] else ...[
          Text(padReceiptLine(methodStr, rupiah(totalVal), chars), style: mono),
        ],
      ],
    );
  }
}

class _WidthButton extends StatelessWidget {
  const _WidthButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(Corners.control - 1),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? primaryInk : Colors.transparent,
          borderRadius: BorderRadius.circular(Corners.control - 1),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: selected ? FontWeight.bold : FontWeight.w500,
            color: selected ? onPrimary : muted,
          ),
        ),
      ),
    );
  }
}

/// Opens an interactive receipt preview modal dialog showing the receipt in either 58 mm or 80 mm.
Future<void> showReceiptPreviewDialog(
  BuildContext context, {
  required String storeName,
  String? address,
  String? phone,
  String? footer,
  bool initialIs80mm = false,
  Uint8List? logoBytes,
  int? saleId,
  DateTime? date,
  String? cashier,
  String? customer,
  List<Map<String, dynamic>>? items,
  num? subtotal,
  num? discount,
  num? charge,
  num? total,
  String method = 'tunai',
  num? paid,
  num? change,
  num? remaining,
  String? note,
}) =>
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Row(
          children: [
            const Icon(Icons.receipt_long_outlined, size: 20),
            const SizedBox(width: Space.sm),
            Text(saleId != null ? 'Pratinjau Struk #$saleId' : 'Pratinjau Struk Toko'),
          ],
        ),
        content: SingleChildScrollView(
          child: Center(
            child: ReceiptPaperPreview(
              storeName: storeName,
              address: address,
              phone: phone,
              footer: footer,
              initialIs80mm: initialIs80mm,
              logoBytes: logoBytes,
              saleId: saleId,
              date: date,
              cashier: cashier,
              customer: customer,
              items: items,
              subtotal: subtotal,
              discount: discount,
              charge: charge,
              total: total,
              method: method,
              paid: paid,
              change: change,
              remaining: remaining,
              note: note,
              allowToggle: true,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Tutup'),
          ),
        ],
      ),
    );

