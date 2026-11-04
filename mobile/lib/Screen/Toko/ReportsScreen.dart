import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';
import 'CostCorrectionDialog.dart';

/// Cash paid out for anything but goods - water, wages, fuel.
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key, required this.api, required this.isAdmin});
  final StoreApi api;
  final bool isAdmin;
  @override State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  List<Map<String, dynamic>> rows = [];
  DateTimeRange range = thisMonth();
  String search = '';
  int page = 1, last = 1;
  num totalJumlah = 0;
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load({int target = 1}) async {
    setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.expenses(from: isoDate(range.start), to: isoDate(range.end), q: search, page: target);
      if (mounted) setState(() { rows = jsonRows(data); page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? 1).toInt(); totalJumlah = number(data['totalJumlah']) ?? 0; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> edit([Map<String, dynamic>? row]) async {
    final values = await showFormDialog(context, title: row == null ? 'Catat pengeluaran' : 'Ubah pengeluaran', fields: [
      FieldSpec('tanggal', 'Tanggal', kind: FieldKind.date, required: true, initial: row?['tanggal']),
      FieldSpec('kategori', 'Kategori', required: true, initial: row?['kategori'], helper: 'Contoh: DPAM, KARYAWAN, BENSIN'),
      FieldSpec('jumlah', 'Jumlah', kind: FieldKind.money, required: true, initial: row?['jumlah']),
      FieldSpec('keterangan', 'Keterangan', initial: row?['keterangan']),
    ], onSave: (v) => row == null ? widget.api.createExpense(v) : widget.api.updateExpense(idNumber(row['id']), v));
    if (values != null && mounted) load(target: page);
  }
  Future<void> remove(Map<String, dynamic> row) async {
    if (!await confirmAction(context, title: 'Hapus pengeluaran?', destructive: true, confirmLabel: 'Hapus',
      message: '${row['kategori']} ${rupiah(row['jumlah'])} tanggal ${row['tanggal']} dihapus dari catatan kas.')) { return; }
    if (mounted && await runAction(context, () => widget.api.deleteExpense(idNumber(row['id'])))) load(target: page);
  }
  Future<void> export() async {
    try {
      final file = await widget.api.expensesExport(from: isoDate(range.start), to: isoDate(range.end), q: search);
      if (mounted) await saveDownload(context, file, 'pengeluaran-${isoDate(range.start)}-${isoDate(range.end)}.xlsx');
    } catch (e) { if (mounted) showError(context, e); }
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: () => load(target: page), maxWidth: 1000, children: [
    ScreenHeader('Pengeluaran', 'Total ${rupiah(totalJumlah)} pada ${rangeLabel(range)}. Belanja barang dicatat di Pembelian.', actions: [
      FilledButton.icon(onPressed: () => edit(), icon: const Icon(Icons.add), label: const Text('Catat')),
      OutlinedButton.icon(onPressed: () async { final picked = await pickRange(context, range); if (picked != null) { range = picked; load(); } },
        icon: const Icon(Icons.date_range), label: Text(rangeLabel(range))),
      if (widget.isAdmin && isDesktop) OutlinedButton.icon(onPressed: export, icon: const Icon(Icons.download), label: const Text('Ekspor Excel')),
    ]),
    SearchBox(onChanged: (v) { search = v; load(); }, hint: 'Cari kategori atau keterangan'),
    const SizedBox(height: Space.md),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    LoadSwitch(loading: false, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows,
      onTap: widget.isAdmin ? edit : null,
      actions: widget.isAdmin ? (r) => [IconButton(tooltip: 'Hapus', onPressed: () => remove(r), icon: const Icon(Icons.delete_outline, size: 20))] : null,
      emptyTitle: 'Belum ada pengeluaran', columns: [
        DataCol('Tanggal', (r) => text(r['tanggal'])),
        DataCol('Kategori', (r) => text(r['kategori'])),
        DataCol('Keterangan', (r) => text(r['keterangan']), flex: 2),
        DataCol('Dicatat oleh', (r) => text(r['userName'])),
        DataCol('Jumlah', (r) => rupiah(r['jumlah']), numeric: true),
      ])),
    Pager(page: page, last: last, busy: loading, onPage: (p) => load(target: p)),
  ]);
}

const movementLabel = {'sale': 'Penjualan', 'sale_cancel': 'Batal jual', 'purchase': 'Pembelian', 'stock_adjustment': 'Penyesuaian'};

/// Every stock change in one ledger: why a product's stock is what it is.
class StockLedgerScreen extends StatefulWidget {
  const StockLedgerScreen({super.key, required this.api});
  final StoreApi api;
  @override State<StockLedgerScreen> createState() => _StockLedgerScreenState();
}

class _StockLedgerScreenState extends State<StockLedgerScreen> {
  List<Map<String, dynamic>> rows = [];
  String search = '', type = '';
  DateTimeRange? range;
  int page = 1, last = 1;
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load({int target = 1}) async {
    setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.stockMovements(q: search, type: type, dari: range == null ? null : isoDate(range!.start), sampai: range == null ? null : isoDate(range!.end), page: target);
      if (mounted) setState(() { rows = jsonRows(data); page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? 1).toInt(); });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: () => load(target: page), children: [
    ScreenHeader('Kartu stok', 'Riwayat keluar-masuk barang dari penjualan, pembelian, dan opname.', actions: [
      OutlinedButton.icon(onPressed: () async { final picked = await pickRange(context, range); if (picked != null) { range = picked; load(); } },
        icon: const Icon(Icons.date_range), label: Text(range == null ? 'Semua tanggal' : rangeLabel(range!))),
      if (range != null) TextButton(onPressed: () { range = null; load(); }, child: const Text('Hapus tanggal')),
    ]),
    SearchBox(onChanged: (v) { search = v; load(); }, hint: 'Cari nama atau kode produk'),
    const SizedBox(height: Space.sm),
    Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
      for (final entry in {'': 'Semua', ...movementLabel}.entries)
        ChoiceChip(label: Text(entry.value), selected: type == entry.key, onSelected: (_) { type = entry.key; load(); }),
    ]),
    const SizedBox(height: Space.md),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    LoadSwitch(loading: false, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows, emptyTitle: 'Tidak ada pergerakan stok', columns: [
      DataCol('Waktu', (r) => dateTimeLabel(r['createdAt']), flex: 2),
      DataCol('Produk', (r) => text(r['namaItem']), flex: 3),
      DataCol('Jenis', (r) => movementLabel[r['movementType']] ?? text(r['movementType']), flex: 2),
      DataCol('Qty', (r) => '${(number(r['quantity']) ?? 0) > 0 ? '+' : ''}${quantityText(r['quantity'])} ${text(r['satuan'], '')}', numeric: true, flex: 2),
      DataCol('Stok', (r) => '${quantityText(r['stockBefore'])} → ${quantityText(r['stockAfter'])} ${text(r['baseUnit'], '')}', numeric: true, flex: 2),
    ])),
    Pager(page: page, last: last, busy: loading, onPage: (p) => load(target: p)),
  ]);
}

/// The owner's report for a period, on a cash basis.
class RekapScreen extends StatefulWidget {
  const RekapScreen({super.key, required this.api});
  final StoreApi api;
  @override State<RekapScreen> createState() => _RekapScreenState();
}

class _RekapScreenState extends State<RekapScreen> {
  Map<String, dynamic>? data;
  DateTimeRange range = thisMonth();
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try { final result = await widget.api.rekap(isoDate(range.start), isoDate(range.end)); if (mounted) setState(() => data = result); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> export() async {
    try {
      final file = await widget.api.rekapExport(isoDate(range.start), isoDate(range.end));
      if (mounted) await saveDownload(context, file, 'rekap-${isoDate(range.start)}-${isoDate(range.end)}.xlsx');
    } catch (e) { if (mounted) showError(context, e); }
  }
  Future<void> correct(Map<String, dynamic> row) async {
    final count = await showCostCorrectionDialog(context, api: widget.api, row: row, range: range);
    if (count == null || !mounted) return;
    showNotice(context, '$count baris dikoreksi. Rekap dihitung ulang.', kind: NoticeKind.success);
    load();
  }
  List<Map<String, dynamic>> rowsOf(String key) => data == null ? const [] : jsonRows(data![key]);
  Widget section(String title, Widget child) => Padding(padding: const EdgeInsets.only(top: Space.xl), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Text(title, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm), child]));

  static const _saranText = {
    'harga_di_bawah_modal': 'Ada barang yang terjual di bawah harga modal. Naikkan harga jualnya.',
    'diskon_memakan_margin': 'Diskon memakan lebih dari separuh laba periode ini.',
    'satuan_margin_tipis': 'Ada satuan dengan margin sangat tipis.',
    'katalog_di_bawah_margin': 'Ada harga di katalog yang di bawah margin minimal toko.',
  };

  @override Widget build(BuildContext context) {
    final summary = data?['summary'] is Map ? jsonObject(data!['summary']) : const <String, dynamic>{};
    final penjelasan = data?['penjelasanLaba'] is Map ? jsonObject(data!['penjelasanLaba']) : const <String, dynamic>{};
    final stock = data?['stockValue'] is Map ? jsonObject(data!['stockValue']) : const <String, dynamic>{};
    final saran = penjelasan.isEmpty ? const <Map<String, dynamic>>[] : jsonRows(penjelasan['saran']);
    final rugi = penjelasan['barisRugi'] is List ? jsonRows(penjelasan['barisRugi']) : const <Map<String, dynamic>>[];
    return ScreenBody(onRefresh: load, children: [
      ScreenHeader('Rekap', 'Omzet dihitung saat uang diterima: bon masuk saat lunas.', actions: [
        OutlinedButton.icon(onPressed: () async { final picked = await pickRange(context, range); if (picked != null) { range = picked; load(); } },
          icon: const Icon(Icons.date_range), label: Text(rangeLabel(range))),
        if (isDesktop) OutlinedButton.icon(onPressed: export, icon: const Icon(Icons.download), label: const Text('Ekspor Excel')),
        OutlinedButton.icon(onPressed: () => showCostCorrectionHistory(context, widget.api), icon: const Icon(Icons.history), label: const Text('Riwayat koreksi HPP')),
      ]),
      LoadSwitch(loading: loading && data == null, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(spacing: Space.md, runSpacing: Space.md, children: [
          StatTile('Omzet tunai', rupiah(summary['omzetTunai']), icon: Icons.payments_outlined),
          StatTile('Omzet QRIS & transfer', rupiah(summary['omzetNonTunai']), icon: Icons.qr_code_2),
          StatTile('Laba kotor', rupiah(summary['labaKotor']), icon: Icons.trending_up, color: (number(summary['labaKotor']) ?? 0) < 0 ? errorColor : successColor),
          StatTile('Transaksi', text(summary['jumlahTransaksi'], '0'), icon: Icons.receipt_long_outlined),
          StatTile('Piutang beredar', rupiah(summary['piutangBeredar']), icon: Icons.account_balance_wallet_outlined, color: warningColor),
          StatTile('Nilai stok', rupiah(stock['totalNilai']), icon: Icons.inventory_2_outlined),
        ]),
        if (penjelasan.isNotEmpty) section('Asal laba', WhitePanel(child: Column(children: [
          SummaryRow('Penjualan kotor', rupiah(penjelasan['penjualanKotor'])),
          SummaryRow('Diskon barang', '-${rupiah(penjelasan['diskonItem'])}'),
          SummaryRow('Diskon nota', '-${rupiah(penjelasan['diskonNota'])}'),
          SummaryRow('Omzet', rupiah(penjelasan['omzet'])),
          SummaryRow('Modal barang', '-${rupiah(penjelasan['modal'])}'),
          SummaryRow('Laba kotor', rupiah(penjelasan['labaKotor']), strong: true),
          if ((number(penjelasan['jumlahBarisRugi']) ?? 0) > 0)
            SummaryRow('${penjelasan['jumlahBarisRugi']} baris terjual rugi', rupiah(penjelasan['totalRugi']), color: errorColor),
        ]))),
        if (rugi.isNotEmpty) section(rugi.length < (number(penjelasan['jumlahBarisRugi']) ?? 0) ? 'Terjual di bawah modal (${rugi.length} terbesar)' : 'Terjual di bawah modal',
          DataView<Map<String, dynamic>>(rows: rugi, actionsWidth: 190,
            actions: (r) => [TextButton(onPressed: loading ? null : () => correct(r), child: const Text('Koreksi HPP'))],
            columns: [
              DataCol('Barang', (r) => '${r['namaItem']} (${r['satuan']}) · nota #${r['saleId']}', flex: 3),
              DataCol('Perhitungan', (r) => '${quantityText(r['qty'])} × (${rupiah(r['hargaJual'])} jual − ${rupiah(r['hargaPokok'])} modal)'
                '${(number(r['diskon']) ?? 0) > 0 ? ' − diskon ${rupiah(r['diskon'])}' : ''}', flex: 4),
              DataCol('Laba', (r) => rupiah(r['laba']), numeric: true),
            ])),
        if (saran.isNotEmpty) section('Saran', Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final s in saran) Padding(padding: const EdgeInsets.only(bottom: Space.sm), child: WhitePanel(child: Row(children: [
            Icon(s['status'] == 'diperbaiki' ? Icons.check_circle_outline : Icons.lightbulb_outline, color: s['status'] == 'diperbaiki' ? successColor : warningColor),
            const SizedBox(width: Space.md),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_saranText[s['kode']] ?? text(s['kode'])),
              if ((s['contoh'] as List?)?.isNotEmpty ?? false) Text('Contoh: ${(s['contoh'] as List).join(', ')}', style: const TextStyle(color: muted, fontSize: 13)),
              if (s['status'] == 'diperbaiki') const Text('Harganya sudah diperbaiki.', style: TextStyle(color: successColor, fontSize: 13)),
            ])),
          ]))),
        ])),
        section('Laba per kategori', DataView<Map<String, dynamic>>(rows: rowsOf('labaPerKategori'), columns: [
          DataCol('Kategori', (r) => text(r['categoryName']), flex: 2),
          DataCol('Omzet', (r) => rupiah(r['omzet']), numeric: true),
          DataCol('Laba', (r) => rupiah(r['laba']), numeric: true),
        ])),
        section('Laba per hari', DataView<Map<String, dynamic>>(rows: rowsOf('labaPerHari'), columns: [
          DataCol('Tanggal', (r) => text(r['tanggal'])),
          DataCol('Omzet', (r) => rupiah(r['omzet']), numeric: true),
          DataCol('Laba', (r) => rupiah(r['laba']), numeric: true),
        ])),
        section('Laba per satuan', DataView<Map<String, dynamic>>(rows: rowsOf('labaPerSatuan'), columns: [
          DataCol('Satuan', (r) => text(r['satuan'])),
          DataCol('Qty', (r) => quantityText(r['qtyTerjual']), numeric: true),
          DataCol('Omzet', (r) => rupiah(r['omzet']), numeric: true),
          DataCol('Laba', (r) => rupiah(r['laba']), numeric: true),
          DataCol('Margin', (r) => '${(number(r['marginPersen']) ?? 0).toStringAsFixed(1)}%', numeric: true),
        ])),
        section('Produk terlaris', DataView<Map<String, dynamic>>(rows: rowsOf('produkTerlaris'), columns: [
          DataCol('Produk', (r) => text(r['namaItem']), flex: 3),
          DataCol('Qty', (r) => quantityText(r['qtyTerjual']), numeric: true),
          DataCol('Penjualan', (r) => rupiah(r['totalPenjualan']), numeric: true),
        ])),
        section('Pembelian per supplier', DataView<Map<String, dynamic>>(rows: rowsOf('pembelianPerSupplier'), columns: [
          DataCol('Supplier', (r) => text(r['supplierName']), flex: 2),
          DataCol('Total pembelian', (r) => rupiah(r['totalPembelian']), numeric: true),
        ])),
        section('Piutang per pelanggan', DataView<Map<String, dynamic>>(rows: rowsOf('piutangPerPelanggan'), emptyTitle: 'Tidak ada piutang', columns: [
          DataCol('Pelanggan', (r) => text(r['namaPelanggan']), flex: 2),
          DataCol('Telepon', (r) => text(r['telepon'])),
          DataCol('Bon belum lunas', (r) => text(r['jumlahBon']), numeric: true),
          DataCol('Total piutang', (r) => rupiah(r['totalPiutang']), numeric: true),
        ])),
        section('Nilai stok', DataView<Map<String, dynamic>>(rows: stock.isEmpty ? const [] : jsonRows(stock['produk']), columns: [
          DataCol('Produk', (r) => text(r['namaItem']), flex: 3),
          DataCol('Stok', (r) => '${quantityText(r['stok'])} ${text(r['satuan'], '')}', numeric: true),
          DataCol('Harga pokok', (r) => rupiah(r['hargaPokok']), numeric: true),
          DataCol('Nilai', (r) => rupiah(r['nilai']), numeric: true),
        ])),
      ])),
    ]);
  }
}
