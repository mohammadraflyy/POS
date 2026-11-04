import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';

/// Corrects the cost (HPP) recorded on a sale line that was sold "at a loss" only because
/// its cost was typed wrong. Preview first, then save with a reason; catalog prices, stock
/// and payments stay untouched, and the change is logged with the admin's name.
///
/// [row] is one `barisRugi` entry from the rekap. Returns how many lines were corrected.
Future<int?> showCostCorrectionDialog(BuildContext context, {required StoreApi api, required Map<String, dynamic> row, required DateTimeRange range}) =>
    showDialog<int>(context: context, builder: (_) => _CostCorrectionDialog(api: api, row: row, range: range));

class _CostCorrectionDialog extends StatefulWidget {
  const _CostCorrectionDialog({required this.api, required this.row, required this.range});
  final StoreApi api;
  final Map<String, dynamic> row;
  final DateTimeRange range;
  @override State<_CostCorrectionDialog> createState() => _CostCorrectionDialogState();
}

class _CostCorrectionDialogState extends State<_CostCorrectionDialog> {
  late final cost = TextEditingController(text: _plain(number(widget.row['hargaPokok']) ?? 0));
  final reason = TextEditingController();
  late DateTimeRange period = widget.range;
  String scope = 'item';
  Map<String, dynamic>? preview;
  String? error;
  bool busy = false;

  static String _plain(num value) => value == value.roundToDouble() ? value.toInt().toString() : value.toString();

  @override void dispose() { cost.dispose(); reason.dispose(); super.dispose(); }

  /// Any change to the request makes the preview stale; the server would refuse its token anyway.
  void _changed() => setState(() { preview = null; error = null; });

  Map<String, dynamic> _request() => {
    'saleItemId': widget.row['saleItemId'], 'scope': scope,
    'from': isoDate(period.start), 'to': isoDate(period.end),
    'hargaPokok': inputRupiah(cost.text),
  };

  Future<void> _preview() async {
    setState(() { error = null; preview = null; });
    try {
      if (cost.text.trim().isEmpty) throw const FormatException('Masukkan HPP yang benar dalam rupiah.');
      setState(() => busy = true);
      final result = await widget.api.previewCostCorrection(_request());
      if (mounted) setState(() => preview = result);
    } catch (e) { if (mounted) setState(() => error = errorText(e)); }
    finally { if (mounted) setState(() => busy = false); }
  }

  Future<void> _save() async {
    if (preview == null || reason.text.trim().isEmpty) return;
    setState(() { busy = true; error = null; });
    try {
      final result = await widget.api.applyCostCorrection({..._request(), 'token': preview!['token'], 'alasan': reason.text.trim()});
      if (mounted) Navigator.pop(context, (number(result['count']) ?? 0).toInt());
    } catch (e) { if (mounted) setState(() { preview = null; error = errorText(e); }); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override Widget build(BuildContext context) {
    final row = widget.row;
    final rows = preview == null ? const <Map<String, dynamic>>[] : jsonRows(preview!['rows']);
    return AlertDialog(
      title: const Text('Koreksi HPP transaksi'),
      content: SizedBox(width: 640, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${row['namaItem']} (${row['satuan']}) · nota #${row['saleId']}', style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: Space.sm),
        Text('Masukkan modal sebenarnya per satuan yang terjual. Laba transaksi dihitung ulang; harga katalog, stok, dan pembayaran tetap. '
          'Perubahan beserta alasan dan nama admin dicatat.', style: TextStyle(color: muted)),
        const SizedBox(height: Space.lg),
        DropdownButtonFormField<String>(initialValue: scope, isExpanded: true, decoration: const InputDecoration(labelText: 'Cakupan koreksi'),
          items: [
            DropdownMenuItem(value: 'item', child: Text('Hanya baris pada nota #${row['saleId']}', overflow: TextOverflow.ellipsis)),
            const DropdownMenuItem(value: 'period', child: Text('Produk dan satuan yang sama pada rentang tanggal', overflow: TextOverflow.ellipsis)),
          ],
          onChanged: busy ? null : (v) { scope = v ?? 'item'; _changed(); }),
        if (scope == 'period') ...[
          const SizedBox(height: Space.md),
          Align(alignment: Alignment.centerLeft, child: OutlinedButton.icon(
            onPressed: busy ? null : () async { final picked = await pickRange(context, period); if (picked != null) { period = picked; _changed(); } },
            icon: const Icon(Icons.date_range), label: Text('Tanggal transaksi: ${rangeLabel(period)}'))),
          const SizedBox(height: Space.xs),
          Text('Semua transaksi selesai dengan produk, satuan, dan konversi yang sama, termasuk bon belum lunas. '
            'Ini tanggal transaksi, bukan tanggal pelunasan bon.', style: TextStyle(color: muted, fontSize: 13)),
        ],
        const SizedBox(height: Space.md),
        TextField(controller: cost, enabled: !busy, keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => _changed(), decoration: InputDecoration(labelText: 'HPP yang benar per ${row['satuan']} (Rp)')),
        const SizedBox(height: Space.md),
        TextField(controller: reason, enabled: !busy, maxLength: 1000, onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(labelText: 'Alasan koreksi', hintText: 'Contoh: HPP salah input, sesuai faktur supplier Rp9.000')),
        Align(alignment: Alignment.centerLeft, child: OutlinedButton(onPressed: busy ? null : _preview, child: const Text('Tampilkan pratinjau'))),
        if (error != null) Padding(padding: const EdgeInsets.only(top: Space.md), child: Text(error!, style: TextStyle(color: errorColor))),
        if (preview != null) ...[
          const SizedBox(height: Space.lg),
          Text('${rows.length} baris akan dikoreksi ke ${rupiah(preview!['hargaPokok'])} per ${preview!['satuan']}.', style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: Space.xs),
          Text.rich(TextSpan(children: [
            TextSpan(text: 'Laba baris terpilih: ${rupiah(preview!['labaLama'])} → '),
            TextSpan(text: rupiah(preview!['labaBaru']), style: TextStyle(fontWeight: FontWeight.w600,
              color: (number(preview!['labaBaru']) ?? 0) < 0 ? errorColor : successColor)),
          ])),
          const SizedBox(height: Space.sm),
          ConstrainedBox(constraints: const BoxConstraints(maxHeight: 240), child: SingleChildScrollView(child: DataView<Map<String, dynamic>>(rows: rows, columns: [
            DataCol('Nota', (r) => '#${r['saleId']} · ${dateTimeLabel(r['tanggal']).split(' ').first}', flex: 2),
            DataCol('Qty', (r) => quantityText(r['qty']), numeric: true),
            DataCol('HPP lama', (r) => rupiah(r['hargaPokokLama']), numeric: true),
            DataCol('Laba lama', (r) => rupiah(r['labaLama']), numeric: true),
            DataCol('Laba baru', (r) => rupiah(r['labaBaru']), numeric: true),
          ]))),
          const SizedBox(height: Space.sm),
          Text('Laba sudah memperhitungkan diskon barang dan bagian diskon nota. Bon masuk Rekap pada periode pelunasannya.', style: TextStyle(color: muted, fontSize: 13)),
        ],
      ]))),
      actions: [
        TextButton(onPressed: busy ? null : () => Navigator.pop(context), child: const Text('Batal')),
        FilledButton(onPressed: busy || preview == null || reason.text.trim().isEmpty ? null : _save, child: Text(busy ? 'Memproses…' : 'Simpan koreksi HPP')),
      ],
    );
  }
}

/// The last corrections made, newest first, with who made them and why.
Future<void> showCostCorrectionHistory(BuildContext context, StoreApi api) => showDialog<void>(context: context, builder: (context) => AlertDialog(
  title: const Text('Riwayat koreksi HPP'),
  content: SizedBox(width: 760, child: FutureBuilder<List<Map<String, dynamic>>>(future: api.costCorrections(), builder: (context, snapshot) {
    if (snapshot.hasError) return Text(errorText(snapshot.error!), style: TextStyle(color: errorColor));
    if (!snapshot.hasData) return const SizedBox(height: 120, child: Center(child: CircularProgressIndicator()));
    return SingleChildScrollView(child: DataView<Map<String, dynamic>>(rows: snapshot.data!, emptyTitle: 'Belum ada koreksi HPP', columns: [
      DataCol('Waktu', (r) => dateTimeLabel(r['createdAt']), flex: 2),
      DataCol('Barang', (r) => '${r['namaItem']} (${r['satuan']}) · #${r['saleId']}', flex: 3),
      DataCol('HPP', (r) => '${rupiah(r['hargaPokokLama'])} → ${rupiah(r['hargaPokokBaru'])}', flex: 2),
      DataCol('Admin', (r) => text(r['adminName'])),
      DataCol('Alasan', (r) => text(r['alasan']), flex: 3),
    ]));
  })),
  actions: [FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Tutup'))],
));
