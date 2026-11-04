import 'dart:async';
import 'package:flutter/material.dart';
import '../../services/business_api.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveSaleScreen.dart';
import '../../Widgets/admin.dart' show dateTimeLabel;
class LiveHistoryScreen extends StatefulWidget {
  const LiveHistoryScreen({super.key, required this.api, this.isAdmin = false});
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
  @override Widget build(BuildContext context) => RefreshIndicator(onRefresh: () => load(target: page), child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(Space.lg), children: [
    const PageIntro('Riwayat penjualan', 'Cari nota, periksa pembayaran, atau cetak ulang.'),
    TextField(onChanged: (v) { query = v; serial++; timer?.cancel(); setState(() => loading = true); timer = Timer(const Duration(milliseconds: 350), () => load()); }, decoration: const InputDecoration(labelText: 'Pencarian', hintText: 'Cari nomor nota atau pelanggan', prefixIcon: Icon(Icons.search))),
    const SizedBox(height: 12), Wrap(spacing: 8, runSpacing: 8, children: [for (final v in ['', 'tunai', 'qris', 'transfer', 'bon']) ChoiceChip(label: Text(v.isEmpty ? 'Semua' : v.toUpperCase()), selected: method == v, onSelected: (_) { method = v; load(); })]),
    const SizedBox(height: 10), Wrap(spacing: 10, runSpacing: 10, children: [
      OutlinedButton.icon(onPressed: () async { final selected = await showDateRangePicker(context: context, firstDate: DateTime(2000), lastDate: DateTime.now(), initialDateRange: range); if (selected != null && mounted) { range = selected; load(); } }, icon: const Icon(Icons.date_range), label: Text(range == null ? 'Rentang tanggal' : '${isoDate(range!.start)} – ${isoDate(range!.end)}')),
      if (range != null) TextButton(onPressed: () { range = null; load(); }, child: const Text('Hapus tanggal')),
      FilterChip(label: const Text('Hanya selesai'), selected: status == 'selesai', onSelected: (v) { status = v ? 'selesai' : ''; load(); }),
      IconButton(onPressed: () => load(target: page), tooltip: 'Muat ulang riwayat', icon: const Icon(Icons.refresh)),
    ]), const SizedBox(height: 16),
    if (loading) const Center(child: CircularProgressIndicator())
    else if (error != null) EmptyPanel(icon: Icons.wifi_off, title: 'Riwayat belum dimuat', message: error!, action: OutlinedButton(onPressed: () => load(), child: const Text('Coba lagi')))
    else if (rows.isEmpty) const EmptyPanel(icon: Icons.receipt_long_outlined, title: 'Belum ada transaksi', message: 'Coba ubah filter atau tanggal.')
    else for (final row in rows) RecordRow(
      title: row['nomorNota']?.toString() ?? 'Nota #${row['saleId'] ?? row['id'] ?? ''}',
      subtitle: (row['namaPelanggan'] ?? 'Umum').toString() + ' / ' + (row['metodePembayaran'] ?? '').toString()
        + (row['status'] == 'dibatalkan' ? ' / DIBATALKAN' : row['metodePembayaran'] == 'bon' && (number(row['dibayar']) ?? 0) < (number(row['total']) ?? 0) ? ' / belum lunas' : '')
        + '\n' + dateTimeLabel(row['createdAt'] ?? row['tanggal']),
      value: rupiah(row['total']),
      onTap: () async {
        try { final id = idNumber(row['saleId'] ?? row['id']); await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LiveSaleScreen(api: widget.api, id: id, isAdmin: widget.isAdmin))); if (mounted) load(target: page); }
        catch (e) { if (context.mounted) showError(context, e); }
      },
    ),
    const SizedBox(height: Space.lg), Row(mainAxisAlignment: MainAxisAlignment.center, children: [IconButton(tooltip: 'Halaman sebelumnya', onPressed: !loading && page > 1 ? () => load(target: page - 1) : null, icon: const Icon(Icons.chevron_left)), Text('$page / $last'), IconButton(tooltip: 'Halaman berikutnya', onPressed: !loading && page < last ? () => load(target: page + 1) : null, icon: const Icon(Icons.chevron_right))]),
  ]));
}
