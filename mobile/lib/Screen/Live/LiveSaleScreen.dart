import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/format.dart';
import '../../models/live_models.dart';
import '../../services/business_api.dart';
import '../../services/mobile_api.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../services/store_api.dart';
import '../Toko/BonActions.dart';
import '../../Widgets/admin.dart' show dateTimeLabel, metodeLabel, text;
class LiveSaleScreen extends StatefulWidget {
  const LiveSaleScreen({super.key, required this.api, required this.id, this.confirmation, this.isAdmin = false, this.onEdit});

  /// "Ubah nota": loads this sale into the till. Null where editing is not offered.
  final Future<void> Function(int saleId)? onEdit;
  final BusinessApi api;
  final int id;
  final Map<String, dynamic>? confirmation;
  /// Admin-only actions (cancel, delete) show only for admins; bon actions for everyone.
  final bool isAdmin;
  @override State<LiveSaleScreen> createState() => _LiveSaleScreenState();
}
class _LiveSaleScreenState extends State<LiveSaleScreen> {
  Map<String, dynamic>? detail;
  String? error, printError;
  bool loading = true, printing = false;
  bool? printed;

  /// The cashier chose no receipt: not a printer failure, nothing to warn about.
  bool get printSkipped => widget.confirmation?['printSkipped'] == true && printed != true;
  @override void initState() {
    super.initState(); printed = widget.confirmation?['printed'] as bool?;
    printError = widget.confirmation?['printError']?.toString(); load();
    if (widget.confirmation != null) WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (printSkipped) {
        showNotice(context, 'Penjualan berhasil disimpan tanpa struk.', title: 'Penjualan tersimpan', kind: NoticeKind.success);
        return;
      }
      showNotice(context, printed == true
        ? 'Penjualan berhasil disimpan. Struk dikirim ke printer PC.'
        : 'Penjualan sudah tersimpan, tetapi struk belum tercetak. Jangan membuat penjualan lagi.',
        title: printed == true ? 'Penjualan tersimpan' : 'Struk belum tercetak',
        details: printError,
        actionLabel: printed == true ? null : 'Cetak ulang',
        onAction: printed == true ? null : printAgain,
        kind: printed == true ? NoticeKind.success : NoticeKind.warning);
    });
  }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try { final data = await widget.api.sale(widget.id); if (mounted) setState(() => detail = data); }
    catch (e) { if (mounted) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> printAgain() async {
    if (printing) return; setState(() => printing = true);
    try { final result = await widget.api.printSale(widget.id); if (result['printed'] != true) throw const ApiFailure('Printer belum mengonfirmasi pencetakan.'); if (mounted) { setState(() { printed = true; printError = null; }); showNotice(context, 'Struk dikirim ke printer PC.', kind: NoticeKind.success); } }
    catch (e) { if (mounted) { setState(() { printed = false; printError = e.toString(); }); showError(context, e); } }
    finally { if (mounted) setState(() => printing = false); }
  }
  void _copyReceiptText() {
    final sale = detail?['sale'] is Map ? jsonObject(detail!['sale']) : detail;
    if (sale == null) return;
    final rawItems = detail?['items'] ?? sale['items'];
    final lines = rawItems is List ? rawItems.whereType<Map>() : const <Map>[];
    final buffer = StringBuffer();
    buffer.writeln('================================');
    buffer.writeln('POINT OF SALES — BUKTI TRANSAKSI');
    buffer.writeln('================================');
    buffer.writeln('Nota     : #${sale['nomorNota'] ?? sale['id'] ?? widget.id}');
    buffer.writeln('Waktu    : ${dateTimeLabel(sale['createdAt'] ?? sale['tanggal'])}');
    final cust = sale['namaPelanggan']?.toString().trim();
    if (cust != null && cust.isNotEmpty) buffer.writeln('Pelanggan: $cust');
    buffer.writeln('--------------------------------');
    for (final item in lines) {
      final name = item['namaItem'] ?? item['name'] ?? 'Barang';
      final q = quantityText(item['qty']);
      final unit = item['satuan'] ?? '';
      final sub = rupiah(item['subtotal']);
      buffer.writeln('$name');
      buffer.writeln('  $q $unit × ${rupiah(item['hargaJual'])} = $sub');
    }
    buffer.writeln('--------------------------------');
    buffer.writeln('Subtotal : ${rupiah(sale['subtotal'] ?? sale['total'])}');
    final disc = number(sale['diskon']) ?? 0;
    if (disc > 0) buffer.writeln('Diskon   : -${rupiah(disc)}');
    final charge = number(sale['biayaLain']) ?? 0;
    if (charge > 0) buffer.writeln('Biaya    : ${rupiah(charge)}');
    buffer.writeln('TOTAL    : ${rupiah(sale['total'])}');
    buffer.writeln('Metode   : ${(sale['metodePembayaran'] ?? 'Tunai').toString().toUpperCase()}');
    buffer.writeln('Dibayar  : ${rupiah(sale['dibayar'])}');
    final change = (number(sale['dibayar']) ?? 0) - (number(sale['total']) ?? 0);
    if (change > 0 && sale['metodePembayaran'] == 'tunai') {
      buffer.writeln('Kembali  : ${rupiah(change)}');
    }
    buffer.writeln('================================');
    buffer.writeln('Terima kasih telah berbelanja!');

    Clipboard.setData(ClipboardData(text: buffer.toString()));
    showNotice(context, 'Teks struk berhasil disalin! Anda dapat menempelkannya ke WhatsApp.', kind: NoticeKind.success);
  }

  @override Widget build(BuildContext context) {
    final sale = detail?['sale'] is Map ? jsonObject(detail!['sale']) : detail;
    final rawItems = detail?['items'] ?? sale?['items'];
    final lines = rawItems is List ? rawItems.whereType<Map>().toList() : <Map>[];
    final payments = detail?['bonPayments']; final edits = detail?['edits'];
    return Scaffold(appBar: AppBar(title: Text('Nota #${widget.id}')), body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
      if (widget.confirmation != null) ...[Center(child: Icon(Icons.check_circle, size: 64, color: successColor)), const SizedBox(height: 12), const Center(child: Text('Penjualan sudah tersimpan', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600))), const SizedBox(height: Space.lg)],
      if (printed != null) WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(printSkipped ? 'Disimpan tanpa struk' : printed! ? 'Struk tercetak di PC' : 'Penjualan tersimpan, cetak belum berhasil', style: const TextStyle(fontWeight: FontWeight.w700)),
        if (printError != null && !printSkipped) Padding(padding: const EdgeInsets.only(top: 8), child: Text(printError!, style: TextStyle(color: errorColor))),
        if (printSkipped) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Kalau pembeli minta struk, tekan Cetak ulang.'))
        else if (!printed!) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Gunakan cetak ulang. Tidak perlu membuat penjualan lagi.')),
      ])), const SizedBox(height: Space.lg),
      if (loading) const Center(child: CircularProgressIndicator())
      else if (error != null) ...[Text(error!, style: TextStyle(color: errorColor)), OutlinedButton(onPressed: load, child: const Text('Muat ulang detail'))]
      else if (sale != null) WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SummaryRow('Nomor nota', (sale['nomorNota'] ?? sale['id'] ?? widget.id).toString()),
        SummaryRow('Pelanggan', (sale['namaPelanggan'] ?? 'Umum').toString()), SummaryRow('Tanggal', dateTimeLabel(sale['tanggal'] ?? sale['createdAt'])),
        SummaryRow('Metode', metodeLabel[sale['metodePembayaran']] ?? text(sale['metodePembayaran'])),
        if (sale['status'] == 'dibatalkan') SummaryRow('Status', 'Dibatalkan', color: errorColor),
        if (sale['kasirName'] != null) SummaryRow('Kasir', sale['kasirName'].toString()),
        if (sale['keterangan'] != null) SummaryRow('Keterangan', sale['keterangan'].toString()), const Divider(),
        for (final line in lines) Padding(padding: const EdgeInsets.only(bottom: 14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text((line['namaItem'] ?? line['productName'] ?? line['namaProduk'] ?? 'Barang #${line['productId'] ?? ''}').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
          Text('${quantityText(line['qty'])} ${(line['namaSatuan'] ?? line['satuan'] ?? '').toString()} • ${rupiah(line['hargaJual'])}${line['priceSource'] == 'price_tier' ? ' · grosir' : line['priceSource'] == 'manual' ? ' · manual' : ''}${(number(line['diskon']) ?? 0) > 0 ? ' · diskon ${rupiah(line['diskon'])}' : ''}', style: TextStyle(color: muted)),
          if (line['subtotal'] != null || line['total'] != null) SummaryRow('Jumlah', rupiah(line['subtotal'] ?? line['total'])),
        ])), const Divider(),
        if ((number(sale['diskon']) ?? 0) > 0) SummaryRow('Diskon nota', '-${rupiah(sale['diskon'])}'),
        if ((number(sale['biayaLain']) ?? 0) > 0) SummaryRow('Biaya lain', rupiah(sale['biayaLain'])),
        SummaryRow('Total', rupiah(sale['total'] ?? widget.confirmation?['total']), strong: true),
        if (sale['status'] != 'dibatalkan' && sale['modal'] != null) SummaryRow('Modal barang', rupiah(sale['modal'])),
        if (sale['status'] != 'dibatalkan' && sale['laba'] != null) SummaryRow('Laba', rupiah(sale['laba']), color: (number(sale['laba']) ?? 0) < 0 ? errorColor : null),
        if (sale['dibayar'] != null) SummaryRow('Dibayar', rupiah(sale['dibayar'])),
        if (sale['metodePembayaran'] == 'bon' && (number(sale['total']) ?? 0) > (number(sale['dibayar']) ?? 0))
          SummaryRow('Sisa piutang', rupiah((number(sale['total']) ?? 0) - (number(sale['dibayar']) ?? 0)), color: errorColor),
        if (sale['kembalian'] != null) SummaryRow('Kembalian', rupiah(sale['kembalian'])),
        if (payments is List && payments.isNotEmpty) ...[const Divider(), const Text('Cicilan bon', style: TextStyle(fontWeight: FontWeight.w700)),
          for (final p in payments.whereType<Map>()) () {
            final ket = (p['keterangan'] ?? '').toString().trim();
            final label = (p['tanggal'] ?? p['createdAt'] ?? '').toString();
            return SummaryRow(ket.isEmpty ? label : '$label · $ket', rupiah(p['jumlah']));
          }(),
        ],
        if (edits is List && edits.isNotEmpty) ...[const Divider(), Text('${edits.length} perubahan tercatat di PC'),
          for (final e in edits.whereType<Map>()) () {
            final who = (e['kasirName'] ?? '').toString().trim();
            final diff = e['totalSebelum'] != null && e['totalSesudah'] != null
                ? ' (${rupiah(e['totalSebelum'])} → ${rupiah(e['totalSesudah'])})'
                : '';
            return Text('${dateTimeLabel(e['createdAt'] ?? e['tanggal'])}${who.isEmpty ? '' : ' · $who'} • ${e['keterangan'] ?? e['reason'] ?? 'Perubahan transaksi'}$diff', style: TextStyle(color: muted, fontSize: 13));
          }(),
        ],
      ])),
      if (detail == null && widget.confirmation != null) SummaryRow('Total tersimpan', rupiah(widget.confirmation!['total']), strong: true),
      if (sale != null && widget.api is StoreApi) ...[const SizedBox(height: Space.lg), SaleActions(api: widget.api as StoreApi, sale: sale, isAdmin: widget.isAdmin, onChanged: load,
        onDeleted: () { if (mounted) Navigator.of(context).pop(); })],
      if (widget.onEdit != null && sale?['status'] == 'selesai') ...[const SizedBox(height: Space.md), OutlinedButton.icon(
        icon: const Icon(Icons.edit_note, size: 18), label: const Text('Ubah nota di kasir'),
        onPressed: () async {
          try {
            await widget.onEdit!(widget.id);
            if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
          } catch (e) { if (mounted) showError(context, e); }
        })],
      const SizedBox(height: Space.xl),
      OutlinedButton.icon(
        onPressed: sale == null ? null : _copyReceiptText,
        icon: const Icon(Icons.share_outlined, size: 18),
        label: const Text('Salin teks struk (Kirim ke WhatsApp)'),
      ),
      const SizedBox(height: Space.sm),
      OutlinedButton.icon(onPressed: printing ? null : printAgain, icon: const Icon(Icons.print_outlined), label: Text(printing ? 'Mengirim ke printer…' : 'Cetak ulang di PC')),
      const SizedBox(height: 12), TextButton(onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst), child: const Text('Kembali ke kasir')),
    ])))));
  }
}
