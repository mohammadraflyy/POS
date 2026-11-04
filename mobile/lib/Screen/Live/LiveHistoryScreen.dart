import 'dart:async';
import 'package:flutter/material.dart';
import '../../services/business_api.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveSaleScreen.dart';
import '../../Widgets/admin.dart';
class LiveHistoryScreen extends StatefulWidget {
  const LiveHistoryScreen({super.key, required this.api, this.isAdmin = false, this.onEditSale});

  /// Loads a nota into the till for editing; admins only.
  final Future<void> Function(int saleId)? onEditSale;
  final BusinessApi api;
  final bool isAdmin;
  @override State<LiveHistoryScreen> createState() => _LiveHistoryScreenState();
}
class _LiveHistoryScreenState extends State<LiveHistoryScreen> {
  List<Map<String, dynamic>> rows = [];
  String query = '', method = '', status = '';
  DateTimeRange? range;
  int page = 1, last = 1, serial = 0;
  bool loading = true;
  String? error;
  Timer? timer;
  @override void initState() { super.initState(); load(); }
  @override void dispose() { timer?.cancel(); super.dispose(); }
  Future<void> load({int target = 1}) async {
    final request = ++serial; setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.sales({'page': '$target', 'search': query, if (method.isNotEmpty) 'metodePembayaran': method, if (status.isNotEmpty) 'status': status,
        if (range != null) 'dari': isoDate(range!.start), if (range != null) 'sampai': isoDate(range!.end)});
      final parsed = jsonRows(data);
      if (mounted && request == serial) setState(() { rows = parsed; page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? target).toInt(); });
    } catch (e) { if (mounted && request == serial) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }
  static const _methods = {'': 'Semua', 'tunai': 'Tunai', 'qris': 'QRIS', 'transfer': 'Transfer', 'bon': 'Bon'};

  static String _status(Map<String, dynamic> row) {
    if (row['status'] == 'dibatalkan') return 'Dibatalkan';
    if (row['metodePembayaran'] == 'bon' && (number(row['dibayar']) ?? 0) < (number(row['total']) ?? 0)) return 'Belum lunas';
    return 'Selesai';
  }

  Future<void> _open(Map<String, dynamic> row) async {
    try {
      final id = idNumber(row['saleId'] ?? row['id']);
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LiveSaleScreen(api: widget.api, id: id, isAdmin: widget.isAdmin, onEdit: widget.onEditSale)));
      if (mounted) load(target: page);
    } catch (e) { if (mounted) showError(context, e); }
  }

  @override Widget build(BuildContext context) => ScreenBody(onRefresh: () => load(target: page), children: [
    ScreenHeader('Riwayat penjualan', range == null ? 'Semua nota, terbaru di atas. Buka nota untuk cetak ulang atau bayar bon.' : 'Nota ${isoDate(range!.start)} sampai ${isoDate(range!.end)}.', actions: [
      OutlinedButton.icon(onPressed: () async { final selected = await showDateRangePicker(context: context, firstDate: DateTime(2000), lastDate: DateTime.now(), initialDateRange: range); if (selected != null && mounted) { range = selected; load(); } },
        icon: const Icon(Icons.date_range, size: 18), label: Text(range == null ? 'Semua tanggal' : '${isoDate(range!.start)} – ${isoDate(range!.end)}')),
      if (range != null) TextButton(onPressed: () { range = null; load(); }, child: const Text('Hapus tanggal')),
    ]),
    TextField(onChanged: (v) { query = v; serial++; timer?.cancel(); setState(() => loading = true); timer = Timer(const Duration(milliseconds: 350), () => load()); },
      decoration: const InputDecoration(hintText: 'Cari nomor nota atau nama pelanggan', prefixIcon: Icon(Icons.search, size: 20))),
    const SizedBox(height: Space.md),
    // one row of filters: the method, then whether cancelled notes show
    Wrap(spacing: Space.sm, runSpacing: Space.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
      for (final entry in _methods.entries) ChoiceChip(label: Text(entry.value), selected: method == entry.key, showCheckmark: false, onSelected: (_) { method = entry.key; load(); }),
      const SizedBox(width: Space.sm),
      FilterChip(label: const Text('Sembunyikan yang batal'), selected: status == 'selesai', onSelected: (v) { status = v ? 'selesai' : ''; load(); }),
    ]),
    const SizedBox(height: Space.md),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    if (error != null) EmptyPanel(icon: Icons.wifi_off, title: 'Riwayat belum dimuat', message: error!, action: OutlinedButton(onPressed: () => load(), child: const Text('Coba lagi')))
    else if (!loading && rows.isEmpty) const EmptyPanel(icon: Icons.receipt_long_outlined, title: 'Tidak ada nota', message: 'Tidak ada nota yang cocok dengan pencarian atau filter ini.')
    else if (rows.isNotEmpty) DataView<Map<String, dynamic>>(rows: rows, onTap: _open, columns: [
      DataCol('Nota', (r) => r['nomorNota']?.toString() ?? '#${r['saleId'] ?? r['id'] ?? ''}'),
      DataCol('Waktu', (r) => dateTimeLabel(r['createdAt'] ?? r['tanggal']), flex: 2),
      DataCol('Pelanggan', (r) => text(r['namaPelanggan'], 'Umum'), flex: 2),
      DataCol('Metode', (r) => _methods[r['metodePembayaran']] ?? text(r['metodePembayaran'])),
      DataCol('Status', _status),
      DataCol('Total', (r) => rupiah(r['total']), numeric: true, flex: 2),
    ]),
    Pager(page: page, last: last, busy: loading, onPage: (p) => load(target: p)),
  ]);
}
