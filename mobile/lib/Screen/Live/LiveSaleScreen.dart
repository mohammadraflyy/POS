import 'package:flutter/material.dart';
import '../../models/live_models.dart';
import '../../services/business_api.dart';
import '../../services/mobile_api.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../services/store_api.dart';
import '../Toko/BonActions.dart';
import '../../Widgets/admin.dart' show dateTimeLabel, metodeLabel, text;
class LiveSaleScreen extends StatefulWidget {
  const LiveSaleScreen({super.key, required this.api, required this.id, this.confirmation, this.isAdmin = false});
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
  @override Widget build(BuildContext context) {
    final sale = detail?['sale'] is Map ? jsonObject(detail!['sale']) : detail;
    final rawItems = detail?['items'] ?? sale?['items'];
    final lines = rawItems is List ? rawItems.whereType<Map>().toList() : <Map>[];
    final payments = detail?['bonPayments']; final edits = detail?['edits'];
    return Scaffold(appBar: AppBar(title: Text('Nota #${widget.id}')), body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
      if (widget.confirmation != null) ...[const Center(child: Icon(Icons.check_circle, size: 64, color: Color(0xFF357361))), const SizedBox(height: 12), const Center(child: Text('Penjualan sudah tersimpan', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600))), const SizedBox(height: Space.lg)],
      if (printed != null) WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(printSkipped ? 'Disimpan tanpa struk' : printed! ? 'Struk tercetak di PC' : 'Penjualan tersimpan, cetak belum berhasil', style: const TextStyle(fontWeight: FontWeight.w700)),
        if (printError != null && !printSkipped) Padding(padding: const EdgeInsets.only(top: 8), child: Text(printError!, style: const TextStyle(color: errorColor))),
        if (printSkipped) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Kalau pembeli minta struk, tekan Cetak ulang.'))
        else if (!printed!) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Gunakan cetak ulang. Tidak perlu membuat penjualan lagi.')),
      ])), const SizedBox(height: Space.lg),
      if (loading) const Center(child: CircularProgressIndicator())
      else if (error != null) ...[Text(error!, style: const TextStyle(color: errorColor)), OutlinedButton(onPressed: load, child: const Text('Muat ulang detail'))]
      else if (sale != null) WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SummaryRow('Nomor nota', (sale['nomorNota'] ?? sale['id'] ?? widget.id).toString()),
        SummaryRow('Pelanggan', (sale['namaPelanggan'] ?? 'Umum').toString()), SummaryRow('Tanggal', dateTimeLabel(sale['tanggal'] ?? sale['createdAt'])),
        SummaryRow('Metode', metodeLabel[sale['metodePembayaran']] ?? text(sale['metodePembayaran'])),
        if (sale['status'] == 'dibatalkan') const SummaryRow('Status', 'Dibatalkan', color: errorColor),
        if (sale['kasirName'] != null) SummaryRow('Kasir', sale['kasirName'].toString()),
        if (sale['keterangan'] != null) SummaryRow('Keterangan', sale['keterangan'].toString()), const Divider(),
        for (final line in lines) Padding(padding: const EdgeInsets.only(bottom: 14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text((line['namaItem'] ?? line['productName'] ?? line['namaProduk'] ?? 'Barang #${line['productId'] ?? ''}').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
          Text('${quantityText(line['qty'])} ${(line['namaSatuan'] ?? line['satuan'] ?? '').toString()} • ${rupiah(line['hargaJual'])}', style: const TextStyle(color: muted)),
          if (line['subtotal'] != null || line['total'] != null) SummaryRow('Jumlah', rupiah(line['subtotal'] ?? line['total'])),
        ])), const Divider(),
        SummaryRow('Total', rupiah(sale['total'] ?? widget.confirmation?['total']), strong: true),
        if (sale['dibayar'] != null) SummaryRow('Dibayar', rupiah(sale['dibayar'])),
        if (sale['metodePembayaran'] == 'bon' && (number(sale['total']) ?? 0) > (number(sale['dibayar']) ?? 0))
          SummaryRow('Sisa piutang', rupiah((number(sale['total']) ?? 0) - (number(sale['dibayar']) ?? 0)), color: errorColor),
        if (sale['kembalian'] != null) SummaryRow('Kembalian', rupiah(sale['kembalian'])),
        if (payments is List && payments.isNotEmpty) ...[const Divider(), const Text('Cicilan bon', style: TextStyle(fontWeight: FontWeight.w700)),
          for (final p in payments.whereType<Map>()) SummaryRow((p['tanggal'] ?? p['createdAt'] ?? '').toString(), rupiah(p['jumlah'])),
        ],
        if (edits is List && edits.isNotEmpty) ...[const Divider(), Text('${edits.length} perubahan tercatat di PC'),
          for (final e in edits.whereType<Map>()) Text('${e['createdAt'] ?? e['tanggal'] ?? ''} • ${e['keterangan'] ?? e['reason'] ?? 'Perubahan transaksi'}', style: const TextStyle(color: muted, fontSize: 13)),
        ],
      ])),
      if (detail == null && widget.confirmation != null) SummaryRow('Total tersimpan', rupiah(widget.confirmation!['total']), strong: true),
      if (sale != null && widget.api is StoreApi) ...[const SizedBox(height: Space.lg), SaleActions(api: widget.api as StoreApi, sale: sale, isAdmin: widget.isAdmin, onChanged: load,
        onDeleted: () { if (mounted) Navigator.of(context).pop(); })],
      const SizedBox(height: Space.xl), OutlinedButton.icon(onPressed: printing ? null : printAgain, icon: const Icon(Icons.print_outlined), label: Text(printing ? 'Mengirim ke printer…' : 'Cetak ulang di PC')),
      const SizedBox(height: 12), TextButton(onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst), child: const Text('Kembali ke kasir')),
    ])))));
  }
}
