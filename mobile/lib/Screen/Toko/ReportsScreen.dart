import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';
import '../Live/LiveSaleScreen.dart';
import '../menus.dart';
import 'CostCorrectionDialog.dart';
import 'MassInputScreen.dart';
import 'ProductDetailScreen.dart';
import 'ProductsScreen.dart' show showEfisiensiHargaDialog;
import '../../Widgets/charts.dart';

/// "-Rp14.000" for a deduction; a real zero stays "Rp0", with no sign to make it look like one.
String _minus(Object? value) => (number(value) ?? 0) == 0 ? rupiah(0) : '-${rupiah(value)}';

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

  Map<String, num> get categoryTotals {
    final map = <String, num>{};
    for (final r in rows) {
      final cat = (r['kategori']?.toString() ?? 'Lainnya').trim();
      final amount = number(r['jumlah']) ?? 0;
      map[cat] = (map[cat] ?? 0) + amount;
    }
    return map;
  }

  @override Widget build(BuildContext context) => ScreenBody(onRefresh: () => load(target: page), maxWidth: 1000, children: [
    ScreenHeader('Pengeluaran', 'Total ${rupiah(totalJumlah)} pada ${rangeLabel(range)}. Belanja barang dicatat di Pembelian.', actions: [
      FilledButton.icon(onPressed: () => edit(), icon: const Icon(Icons.add), label: const Text('Catat')),
      OutlinedButton.icon(onPressed: () async { final picked = await pickRange(context, range); if (picked != null) { range = picked; load(); } },
        icon: const Icon(Icons.date_range), label: Text(rangeLabel(range))),
      if (widget.isAdmin && isDesktop) OutlinedButton.icon(onPressed: export, icon: const Icon(Icons.download), label: const Text('Ekspor Excel')),
    ]),
    DateQuickChips(selected: range, onChanged: (r) { if (r != null) { range = r; load(); } }),
    const SizedBox(height: Space.sm),
    if (categoryTotals.isNotEmpty) ...[
      Wrap(
        spacing: Space.xs,
        runSpacing: Space.xs,
        children: [
          for (final entry in categoryTotals.entries)
            ActionChip(
              visualDensity: VisualDensity.compact,
              label: Text('${entry.key}: ${rupiah(entry.value)}'),
              onPressed: () {
                search = entry.key;
                load();
              },
            ),
        ],
      ),
      const SizedBox(height: Space.sm),
    ],
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
    DateQuickChips(selected: range, allowAll: true, onChanged: (r) { range = r; load(); }),
    const SizedBox(height: Space.sm),
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
  const RekapScreen({super.key, required this.api, this.onEditSale, this.onOpenMenu, this.isAdmin = true});
  final StoreApi api;
  final Future<void> Function(int saleId)? onEditSale;
  final void Function(Menu menu)? onOpenMenu;
  final bool isAdmin;
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
  Future<void> editProduct(int productId) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => MassInputScreen(api: widget.api, ids: [productId]),
    ));
    if (changed == true && mounted) load();
  }
  Future<void> openProductDetail(int productId) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => ProductDetailScreen(api: widget.api, productId: productId, isAdmin: widget.isAdmin),
    ));
    if (mounted) load();
  }
  Future<void> openEfisiensi({String initialCakupan = 'margin'}) async {
    final changed = await showEfisiensiHargaDialog(context, widget.api, initialCakupan: initialCakupan);
    if (changed == true && mounted) load();
  }

  void shareRekapWhatsApp() {
    if (data == null) return;
    final summary = data!['summary'] is Map ? jsonObject(data!['summary']) : const <String, dynamic>{};
    final laba = rupiah(summary['labaKotor']);
    final omzetTunai = rupiah(summary['omzetTunai']);
    final omzetNonTunai = rupiah(summary['omzetNonTunai']);
    final totalTrx = text(summary['jumlahTransaksi'], '0');
    final piutang = rupiah(summary['piutangBeredar']);
    final period = rangeLabel(range);

    final sb = StringBuffer();
    sb.writeln('📊 *RINGKASAN REKAP PENJUALAN TOKO*');
    sb.writeln('📅 Periode: $period');
    sb.writeln('-----------------------------------');
    sb.writeln('💰 *Laba Kotor:* $laba');
    sb.writeln('💵 *Omzet Tunai:* $omzetTunai');
    sb.writeln('💳 *Omzet Non-Tunai:* $omzetNonTunai');
    sb.writeln('🧾 *Jumlah Transaksi:* $totalTrx');
    sb.writeln('⏳ *Piutang Bon Beredar:* $piutang');
    sb.writeln('-----------------------------------');
    sb.writeln('_Dicetak otomatis dari POS Kasir Toko_');

    Clipboard.setData(ClipboardData(text: sb.toString()));
    showNotice(context, 'Teks rekap berhasil disalin ke clipboard! Siap ditempel di WhatsApp.', kind: NoticeKind.success);
  }

  List<Map<String, dynamic>> rowsOf(String key) => data == null ? const [] : jsonRows(data![key]);
  Widget section(String title, Widget child) => Padding(padding: const EdgeInsets.only(top: Space.xl), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Text(title, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm), child]));

  static String _formatSaran(Map<String, dynamic> s) {
    final kode = s['kode']?.toString();
    final jumlah = number(s['jumlah']) ?? 0;
    final nilai = s['nilai'];
    final persen = number(s['persen']) ?? 0;
    return switch (kode) {
      'harga_di_bawah_modal' => '$jumlah baris terjual di bawah modal (rugi ${rupiah(nilai)}). Periksa HPP atau naikkan harga jualnya.',
      'diskon_memakan_margin' => 'Diskon (${rupiah(nilai)}) memakan ${persen.toStringAsFixed(0)}% dari laba kotor sebelum diskon.',
      'satuan_margin_tipis' => '$jumlah satuan memiliki margin tipis (${persen.toStringAsFixed(1)}%). Cek harga jual atau harga beli satuan.',
      'katalog_di_bawah_margin' => '$jumlah harga di katalog berada di bawah margin minimal toko (${persen.toStringAsFixed(0)}%).',
      _ => text(kode),
    };
  }

  @override Widget build(BuildContext context) {
    final summary = data?['summary'] is Map ? jsonObject(data!['summary']) : const <String, dynamic>{};
    final penjelasan = data?['penjelasanLaba'] is Map ? jsonObject(data!['penjelasanLaba']) : const <String, dynamic>{};
    final stock = data?['stockValue'] is Map ? jsonObject(data!['stockValue']) : const <String, dynamic>{};
    final saran = penjelasan.isEmpty ? const <Map<String, dynamic>>[] : jsonRows(penjelasan['saran']);
    final rugi = penjelasan['barisRugi'] is List ? jsonRows(penjelasan['barisRugi']) : const <Map<String, dynamic>>[];
    final salesHistory = data?['salesHistory'] is List ? jsonRows(data!['salesHistory']) : const <Map<String, dynamic>>[];
    return ScreenBody(onRefresh: load, children: [
      ScreenHeader('Rekap', 'Omzet dihitung saat uang diterima: bon masuk saat lunas.', actions: [
        OutlinedButton.icon(onPressed: () async { final picked = await pickRange(context, range); if (picked != null) { range = picked; load(); } },
          icon: const Icon(Icons.date_range), label: Text(rangeLabel(range))),
        OutlinedButton.icon(onPressed: shareRekapWhatsApp, icon: const Icon(Icons.share_outlined), label: const Text('Bagi ke WA')),
        if (isDesktop) OutlinedButton.icon(onPressed: export, icon: const Icon(Icons.download), label: const Text('Ekspor Excel')),
        if (widget.isAdmin) OutlinedButton.icon(onPressed: () => openEfisiensi(), icon: const Icon(Icons.trending_up), label: const Text('Efisiensi harga')),
        OutlinedButton.icon(onPressed: () => showCostCorrectionHistory(context, widget.api), icon: const Icon(Icons.history), label: const Text('Riwayat koreksi HPP')),
      ]),
      DateQuickChips(selected: range, onChanged: (r) { if (r != null) { range = r; load(); } }),
      const SizedBox(height: Space.sm),
      LoadSwitch(loading: loading && data == null, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // the period's answer leads; the stock value lives with its own table below
        KpiStrip([
          Kpi('Laba kotor', rupiah(summary['labaKotor']), lead: true, caption: rangeLabel(range),
            color: (number(summary['labaKotor']) ?? 0) < 0 ? errorColor : successColor),
          Kpi('Omzet tunai', rupiah(summary['omzetTunai']), caption: 'termasuk pelunasan bon'),
          Kpi('Omzet QRIS & transfer', rupiah(summary['omzetNonTunai'])),
          Kpi('Transaksi', text(summary['jumlahTransaksi'], '0')),
          Kpi('Piutang beredar', rupiah(summary['piutangBeredar']), caption: 'semua bon belum lunas',
            color: (number(summary['piutangBeredar']) ?? 0) > 0 ? warningColor : null),
        ]),
        if (rowsOf('labaPerHari').isNotEmpty) section('Laba per hari', WhitePanel(child: Builder(builder: (context) {
          // every day of the period up to today, on a time scale: a day with no sale is an empty slot, not a skipped one
          final byDay = {for (final r in rowsOf('labaPerHari')) r['tanggal'].toString(): number(r['laba']) ?? 0};
          final today = DateTime.now();
          final end = range.end.isAfter(today) ? DateTime(today.year, today.month, today.day) : range.end;
          final days = [for (var d = DateTime(range.start.year, range.start.month, range.start.day); !d.isAfter(end); d = DateTime(d.year, d.month, d.day + 1)) d];
          return ColumnChart(labels: [for (final d in days) '${d.day}/${d.month}'], values: [for (final d in days) byDay[isoDate(d)] ?? 0],
            semanticLabel: 'Laba per hari, ${rangeLabel(range)}');
        }))),
        if (penjelasan.isNotEmpty) section('Asal laba', WhitePanel(child: Column(children: [
          SummaryRow('Penjualan kotor', rupiah(penjelasan['penjualanKotor'])),
          SummaryRow('Diskon barang', _minus(penjelasan['diskonItem']), color: (number(penjelasan['diskonItem']) ?? 0) > 0 ? errorColor : null),
          SummaryRow('Diskon nota', _minus(penjelasan['diskonNota']), color: (number(penjelasan['diskonNota']) ?? 0) > 0 ? errorColor : null),
          SummaryRow('Omzet', rupiah(penjelasan['omzet'])),
          SummaryRow('Modal barang', _minus(penjelasan['modal'])),
          SummaryRow('Laba kotor', rupiah(penjelasan['labaKotor']), strong: true,
            color: (number(penjelasan['labaKotor']) ?? 0) >= 0 ? successColor : errorColor),
          if ((number(penjelasan['jumlahBarisRugi']) ?? 0) > 0)
            SummaryRow('${penjelasan['jumlahBarisRugi']} baris terjual rugi (minus)', '-${rupiah(penjelasan['totalRugi'])}', color: errorColor),
        ]))),
        if (rugi.isNotEmpty) section(rugi.length < (number(penjelasan['jumlahBarisRugi']) ?? 0) ? 'Terjual di bawah modal (${rugi.length} terbesar)' : 'Terjual di bawah modal',
          DataView<Map<String, dynamic>>(rows: rugi, actionsWidth: 360,
            actions: (r) => [
              TextButton(onPressed: loading ? null : () => correct(r), child: const Text('Koreksi HPP')),
              if (r['productId'] != null) TextButton(onPressed: loading ? null : () => editProduct(idNumber(r['productId'])), child: const Text('Ubah produk')),
              if (widget.onEditSale != null && r['saleId'] != null) TextButton(onPressed: loading ? null : () => widget.onEditSale!(idNumber(r['saleId'])), child: const Text('Ubah nota')),
            ],
            columns: [
              DataCol('Barang', (r) => '${r['namaItem']} (${r['satuan']}) · nota #${r['saleId']}', flex: 3),
              DataCol('Perhitungan', (r) => '${quantityText(r['qty'])} × (${rupiah(r['hargaJual'])} jual − ${rupiah(r['hargaPokok'])} modal)'
                '${(number(r['diskon']) ?? 0) > 0 ? ' − diskon ${rupiah(r['diskon'])}' : ''}', flex: 4),
              DataCol('Laba', (r) => rupiah(r['laba']), numeric: true),
            ])),
        if (saran.isNotEmpty) section('Saran', Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final s in saran) Padding(padding: const EdgeInsets.only(bottom: Space.sm), child: WhitePanel(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(s['status'] == 'diperbaiki' ? Icons.check_circle_outline : Icons.lightbulb_outline, color: s['status'] == 'diperbaiki' ? successColor : warningColor),
            const SizedBox(width: Space.md),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_formatSaran(s)),
              if ((s['contoh'] as List?)?.isNotEmpty ?? false) Text('Contoh: ${(s['contoh'] as List).join(', ')}', style: TextStyle(color: muted, fontSize: 13)),
              if (s['status'] == 'diperbaiki') Text('Harganya sudah diperbaiki.', style: TextStyle(color: successColor, fontSize: 13)),
              const SizedBox(height: 6),
              Wrap(spacing: Space.xs, runSpacing: Space.xs, children: [
                if (widget.isAdmin && (s['kode'] == 'harga_di_bawah_modal' || s['kode'] == 'katalog_di_bawah_margin' || s['kode'] == 'satuan_margin_tipis'))
                  OutlinedButton(
                    onPressed: () => openEfisiensi(initialCakupan: s['kode'] == 'harga_di_bawah_modal' ? 'rugi' : 'margin'),
                    child: const Text('Efisiensi harga'),
                  ),
                for (final p in (s['produk'] as List? ?? const []).whereType<Map>().take(5)) ...[
                  if (p['id'] != null) TextButton(
                    onPressed: () => editProduct(idNumber(p['id'])),
                    child: Text('Ubah produk ${p['namaItem'] ?? ''}'),
                  ),
                  if (p['id'] != null) TextButton(
                    onPressed: () => openProductDetail(idNumber(p['id'])),
                    child: Text('Harga satuan ${p['namaItem'] ?? ''}'),
                  ),
                ],
                if (widget.onEditSale != null)
                  for (final sid in (s['saleIds'] as List? ?? const []).take(5))
                    if (number(sid) != null)
                      TextButton(
                        onPressed: () => widget.onEditSale!(idNumber(sid)),
                        child: Text('Ubah nota #$sid'),
                      ),
                if (s['kode'] == 'satuan_margin_tipis' && widget.onOpenMenu != null)
                  TextButton(
                    onPressed: () => widget.onOpenMenu!(Menu.pembelian),
                    child: const Text('Buka pembelian'),
                  ),
                if (s['kode'] == 'katalog_di_bawah_margin' && widget.onOpenMenu != null)
                  TextButton(
                    onPressed: () => widget.onOpenMenu!(Menu.pengaturan),
                    child: const Text('Atur margin minimal'),
                  ),
              ]),
            ])),
          ]))),
        ])),
        section('Laba per kategori', DataView<Map<String, dynamic>>(rows: rowsOf('labaPerKategori'), columns: [
          DataCol('Kategori', (r) => text(r['categoryName']), flex: 2),
          DataCol('Omzet', (r) => rupiah(r['omzet']), numeric: true),
          DataCol('Laba', (r) => rupiah(r['laba']), numeric: true),
        ])),
        section('Laba per hari, angkanya', DataView<Map<String, dynamic>>(rows: rowsOf('labaPerHari'), columns: [
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
        if (salesHistory.isNotEmpty) section('Riwayat transaksi periode ini', DataView<Map<String, dynamic>>(
          rows: salesHistory,
          onTap: (r) async {
            await Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => LiveSaleScreen(api: widget.api, id: idNumber(r['id']), isAdmin: widget.isAdmin, onEdit: widget.onEditSale),
            ));
            if (mounted) load();
          },
          columns: [
            DataCol('Nota', (r) => '#${r['id']}'),
            DataCol('Waktu', (r) => dateTimeLabel(r['createdAt']), flex: 2),
            DataCol('Pelanggan', (r) => text(r['namaPelanggan'], 'Umum'), flex: 2),
            DataCol('Metode', (r) => metodeLabel[r['metodePembayaran']] ?? text(r['metodePembayaran'])),
            DataCol('Status', (r) => r['status'] == 'dibatalkan' ? 'Dibatalkan' : 'Selesai'),
            DataCol('Total', (r) => rupiah(r['total']), numeric: true),
            DataCol('Dibayar', (r) => rupiah(r['dibayar']), numeric: true),
          ],
        )),
        section('Nilai stok · ${rupiah(stock['totalNilai'])}', DataView<Map<String, dynamic>>(rows: stock.isEmpty ? const [] : jsonRows(stock['produk']), columns: [
          DataCol('Kode', (r) => text(r['kodeItem'])),
          DataCol('Produk', (r) => text(r['namaItem']), flex: 3),
          DataCol('Stok', (r) => '${quantityText(r['stok'])} ${text(r['satuan'], '')}', numeric: true),
          DataCol('Harga pokok', (r) => rupiah(r['hargaPokok']), numeric: true),
          DataCol('Nilai', (r) => rupiah(r['nilai']), numeric: true),
        ])),
      ])),
    ]);
  }
}
