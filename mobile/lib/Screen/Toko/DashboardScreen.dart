import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';

/// Today at a glance: takings, outstanding bon, low stock, and the latest sales.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.api});
  final StoreApi api;
  @override State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? data;
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = data == null; error = null; });
    try { final result = await widget.api.dashboard(); if (mounted) setState(() => data = result); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  @override Widget build(BuildContext context) {
    final summary = data?['summary'] is Map ? jsonObject(data!['summary']) : const <String, dynamic>{};
    final lowStock = data == null ? const <Map<String, dynamic>>[] : jsonRows(data!['stokMenipis']);
    final topProducts = data == null ? const <Map<String, dynamic>>[] : jsonRows(data!['produkTerlarisHariIni']);
    final latest = data == null ? const <Map<String, dynamic>>[] : jsonRows(data!['transaksiTerbaru']);
    return ScreenBody(onRefresh: load, children: [
      ScreenHeader('Dashboard', 'Ringkasan hari ini. Omzet bon dihitung saat lunas.', actions: [
        IconButton(onPressed: load, tooltip: 'Muat ulang', icon: const Icon(Icons.refresh)),
      ]),
      LoadSwitch(loading: loading, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(spacing: Space.md, runSpacing: Space.md, children: [
          StatTile('Omzet tunai', rupiah(summary['omzetTunai']), icon: Icons.payments_outlined),
          StatTile('Omzet QRIS & transfer', rupiah(summary['omzetNonTunai']), icon: Icons.qr_code_2),
          StatTile('Laba kotor', rupiah(summary['labaKotor']), icon: Icons.trending_up, color: successColor),
          StatTile('Jumlah transaksi', text(summary['jumlahTransaksi'], '0'), icon: Icons.receipt_long_outlined),
          StatTile('Piutang bon beredar', rupiah(summary['piutangBeredar']), icon: Icons.account_balance_wallet_outlined, color: warningColor),
        ]),
        const SizedBox(height: Space.xl),
        Text('Stok menipis', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm),
        DataView<Map<String, dynamic>>(rows: lowStock, emptyTitle: 'Semua stok aman', emptyMessage: 'Tidak ada barang aktif dengan stok 5 atau kurang.', columns: [
          DataCol('Produk', (r) => text(r['namaItem']), flex: 3),
          DataCol('Kode', (r) => text(r['kodeItem'])),
          DataCol('Stok', (r) => '${quantityText(r['stok'])} ${text(r['satuan'], '')}', numeric: true),
        ]),
        const SizedBox(height: Space.xl),
        Text('Produk terlaris hari ini', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm),
        DataView<Map<String, dynamic>>(rows: topProducts, emptyTitle: 'Belum ada penjualan hari ini', columns: [
          DataCol('Produk', (r) => text(r['namaItem']), flex: 3),
          DataCol('Qty', (r) => quantityText(r['qtyTerjual']), numeric: true),
          DataCol('Penjualan', (r) => rupiah(r['totalPenjualan']), numeric: true),
        ]),
        const SizedBox(height: Space.xl),
        Text('Transaksi terbaru', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm),
        DataView<Map<String, dynamic>>(rows: latest, columns: [
          DataCol('Waktu', (r) => dateTimeLabel(r['createdAt']), flex: 2),
          DataCol('Item', (r) => text(r['itemSummary']), flex: 4),
          DataCol('Metode', (r) => metodeLabel[r['metodePembayaran']] ?? text(r['metodePembayaran'])),
          DataCol('Status', (r) => r['status'] == 'dibatalkan' ? 'Batal' : (r['metodePembayaran'] == 'bon' && (number(r['dibayar']) ?? 0) < (number(r['total']) ?? 0) ? 'Belum lunas' : 'Lunas')),
          DataCol('Total', (r) => rupiah(r['total']), numeric: true),
        ]),
      ])),
    ]);
  }
}
