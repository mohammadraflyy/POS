import 'package:flutter/material.dart';
import '../../services/mutation_guard.dart';
import '../Live/LivePurchaseScreen.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';

/// Recorded purchase invoices, newest first, with their remaining supplier debt.
class PurchaseListScreen extends StatefulWidget {
  const PurchaseListScreen({super.key, required this.api, this.onChanged, this.guard});
  final StoreApi api;
  final VoidCallback? onChanged;
  final MutationGuard? guard;
  @override State<PurchaseListScreen> createState() => _PurchaseListScreenState();
}

class _PurchaseListScreenState extends State<PurchaseListScreen> {
  List<Map<String, dynamic>> rows = [];
  DateTimeRange? range;
  int page = 1, last = 1;
  num grandTotal = 0;
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load({int target = 1}) async {
    setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.purchases(target, dari: range == null ? null : isoDate(range!.start), sampai: range == null ? null : isoDate(range!.end));
      if (mounted) setState(() { rows = jsonRows(data); page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? 1).toInt(); grandTotal = number(data['totalKeseluruhan']) ?? 0; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> open(Map<String, dynamic> row) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PurchaseDetailScreen(api: widget.api, id: idNumber(row['id']), onChanged: widget.onChanged, guard: widget.guard, supplierName: row['supplierName']?.toString())));
    if (mounted) load(target: page);
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: () => load(target: page), children: [
    ScreenHeader('Daftar pembelian', 'Total ${rupiah(grandTotal)}${range == null ? '' : ' pada ${rangeLabel(range!)}'}.', actions: [
      OutlinedButton.icon(onPressed: () async { final picked = await pickRange(context, range); if (picked != null) { range = picked; load(); } },
        icon: const Icon(Icons.date_range), label: Text(range == null ? 'Semua tanggal' : rangeLabel(range!))),
      if (range != null) TextButton(onPressed: () { range = null; load(); }, child: const Text('Hapus filter')),
    ]),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    LoadSwitch(loading: false, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows, onTap: open,
      emptyTitle: 'Belum ada pembelian', columns: [
        DataCol('No.', (r) => '#${r['id']}'),
        DataCol('Tanggal', (r) => text(r['tanggal'])),
        DataCol('Supplier', (r) => text(r['supplierName'], 'Tanpa supplier'), flex: 2),
        DataCol('Barang', (r) => text(r['itemSummary']), flex: 4),
        DataCol('Total', (r) => rupiah(r['total']), numeric: true, flex: 2),
        DataCol('Sisa hutang', (r) => (number(r['sisa']) ?? 0) > 0 ? rupiah(r['sisa']) : 'Lunas', numeric: true, flex: 2),
      ])),
    Pager(page: page, last: last, busy: loading, onPage: (p) => load(target: p)),
  ]);
}

class PurchaseDetailScreen extends StatefulWidget {
  const PurchaseDetailScreen({super.key, required this.api, required this.id, this.onChanged, this.guard, this.supplierName});
  final StoreApi api;
  final int id;
  final VoidCallback? onChanged;

  /// The workspace's guard, so an edited purchase is protected like a new one; editing is
  /// offered only when it is given.
  final MutationGuard? guard;
  final String? supplierName;
  @override State<PurchaseDetailScreen> createState() => _PurchaseDetailScreenState();
}

class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
  Map<String, dynamic>? detail;
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try { final data = await widget.api.purchaseDetail(widget.id); if (mounted) setState(() => detail = data); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> remove() async {
    if (!await confirmAction(context, title: 'Hapus pembelian #${widget.id}?', destructive: true, confirmLabel: 'Hapus',
      message: 'Stok dan harga pokok barangnya dikembalikan, dan semua pembayaran hutang atas faktur ini ikut terhapus.')) { return; }
    if (mounted && await runAction(context, () => widget.api.deletePurchase(widget.id), success: 'Pembelian dihapus.')) {
      widget.onChanged?.call();
      if (mounted) Navigator.of(context).pop();
    }
  }
  Future<void> edit() async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => Scaffold(
      appBar: AppBar(title: Text('Ubah pembelian #${widget.id}')),
      body: WorkArea(child: LivePurchaseScreen(api: widget.api, guard: widget.guard!, onSaved: widget.onChanged,
        editing: PurchaseEdit.fromDetail(detail!, supplierName: widget.supplierName))))));
    if (changed == true && mounted) { showNotice(context, 'Pembelian #${widget.id} diperbarui.', kind: NoticeKind.success); load(); }
  }

  @override Widget build(BuildContext context) {
    final items = detail == null ? const <Map<String, dynamic>>[] : jsonRows(detail!['items']);
    final total = number(detail?['total']) ?? 0;
    final paid = (number(detail?['uangMuka']) ?? 0) + (number(detail?['cicilan']) ?? 0);
    return Scaffold(appBar: AppBar(title: Text('Pembelian #${widget.id}')), body: ScreenBody(onRefresh: load, maxWidth: 900, children: [
      LoadSwitch(loading: loading, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        WhitePanel(child: Column(children: [
          SummaryRow('Tanggal', text(detail?['tanggal'])),
          SummaryRow('Catatan', text(detail?['catatan'])),
          SummaryRow('Uang muka', rupiah(detail?['uangMuka'])),
          SummaryRow('Cicilan', rupiah(detail?['cicilan'])),
          SummaryRow('Sisa hutang', total - paid > 0 ? rupiah(total - paid) : 'Lunas', color: total - paid > 0 ? warningColor : successColor),
          SummaryRow('Total', rupiah(total), strong: true),
        ])),
        const SizedBox(height: Space.lg),
        DataView<Map<String, dynamic>>(rows: items, columns: [
          DataCol('Barang', (i) => text(i['namaItem']), flex: 3),
          DataCol('Qty', (i) {
            final unitId = i['productUnitId'];
            final units = jsonRows({'data': i['units'] ?? []});
            final satuan = unitId == null ? i['baseSatuan'] : units.firstWhere((u) => u['id'] == unitId, orElse: () => {'satuan': ''})['satuan'];
            return '${quantityText(i['qty'])} $satuan';
          }, numeric: true),
          DataCol('Harga beli', (i) => rupiah(i['hargaBeli']), numeric: true),
          DataCol('Subtotal', (i) => rupiah((number(i['qty']) ?? 0) * (number(i['hargaBeli']) ?? 0)), numeric: true),
        ]),
        const SizedBox(height: Space.xl),
        Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
          if (widget.guard != null && detail != null) OutlinedButton.icon(onPressed: edit, icon: const Icon(Icons.edit_outlined, size: 18), label: const Text('Ubah pembelian')),
          OutlinedButton.icon(onPressed: remove, style: OutlinedButton.styleFrom(foregroundColor: errorColor),
            icon: const Icon(Icons.delete_outline, size: 18), label: const Text('Hapus pembelian')),
        ]),
      ])),
    ]));
  }
}

/// Unpaid invoices per supplier, paying them (oldest first), and correcting the record.
class SupplierDebtScreen extends StatefulWidget {
  const SupplierDebtScreen({super.key, required this.api, this.guard, this.onChanged});
  final StoreApi api;
  final MutationGuard? guard;
  final VoidCallback? onChanged;
  @override State<SupplierDebtScreen> createState() => _SupplierDebtScreenState();
}

class _SupplierDebtScreenState extends State<SupplierDebtScreen> {
  List<Map<String, dynamic>> debts = [];
  List<Map<String, dynamic>> payments = [];
  int? supplierId;
  String supplierName = '';
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.supplierDebts();
      final history = supplierId == null ? <Map<String, dynamic>>[] : await widget.api.supplierPayments(supplierId!);
      if (mounted) setState(() { debts = data; payments = history; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Map<int, ({String name, num sisa, int faktur})> get groups {
    final result = <int, ({String name, num sisa, int faktur})>{};
    for (final d in debts) {
      final id = d['supplierId'];
      if (id is! int) continue;
      final old = result[id];
      result[id] = (name: text(d['supplierName']), sisa: (old?.sisa ?? 0) + (number(d['sisa']) ?? 0), faktur: (old?.faktur ?? 0) + 1);
    }
    return result;
  }
  void select(int id, String name) { setState(() { supplierId = id; supplierName = name; }); load(); }

  Future<void> pay() async {
    final sisa = groups[supplierId]?.sisa ?? 0;
    final values = await showFormDialog(context, title: 'Bayar $supplierName', saveLabel: 'Simpan pembayaran', fields: [
      FieldSpec('jumlah', 'Jumlah bayar (sisa ${rupiah(sisa)})', kind: FieldKind.money, required: true),
      const FieldSpec('tanggal', 'Tanggal', kind: FieldKind.date, required: true),
      const FieldSpec('keterangan', 'Keterangan'),
    ], onSave: (v) => widget.api.paySupplier({...v, 'supplierId': supplierId}));
    if (values != null && mounted) { showNotice(context, 'Pembayaran dicatat ke faktur terlama lebih dulu.', kind: NoticeKind.success); load(); }
  }
  Future<void> editPayment(Map<String, dynamic> p) async {
    final values = await showFormDialog(context, title: 'Ubah pembayaran', fields: [
      FieldSpec('jumlah', 'Jumlah bayar', kind: FieldKind.money, required: true, initial: p['jumlah']),
      FieldSpec('tanggal', 'Tanggal', kind: FieldKind.date, required: true, initial: p['tanggal']),
      FieldSpec('keterangan', 'Keterangan', initial: p['keterangan']),
    ], onSave: (v) => widget.api.updateSupplierPayment(idNumber(p['id']), v));
    if (values != null && mounted) load();
  }
  Future<void> deletePayment(Map<String, dynamic> p) async {
    if (!await confirmAction(context, title: 'Hapus pembayaran?', destructive: true, confirmLabel: 'Hapus',
      message: 'Pembayaran ${rupiah(p['jumlah'])} tanggal ${p['tanggal']} dihapus, dan jumlahnya kembali menjadi hutang.')) { return; }
    if (mounted && await runAction(context, () => widget.api.deleteSupplierPayment(idNumber(p['id'])))) load();
  }
  Future<void> setSisa(Map<String, dynamic> invoice) async {
    final values = await showFormDialog(context, title: 'Ubah sisa hutang faktur #${invoice['purchaseId']}', fields: [
      FieldSpec('sisa', 'Sisa hutang (total ${rupiah(invoice['total'])})', kind: FieldKind.money, required: true, initial: invoice['sisa'],
        helper: 'Cicilan yang sudah tercatat tidak berubah; yang disesuaikan uang mukanya.'),
    ], onSave: (v) => widget.api.setSisaHutang(idNumber(invoice['purchaseId']), v['sisa'] as num));
    if (values != null && mounted) load();
  }
  Future<void> openInvoice(Map<String, dynamic> invoice) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => PurchaseDetailScreen(
        api: widget.api,
        id: idNumber(invoice['purchaseId']),
        guard: widget.guard,
        onChanged: widget.onChanged,
        supplierName: supplierName,
      ),
    ));
    if (mounted) load();
  }

  @override Widget build(BuildContext context) {
    final grouped = groups;
    final total = grouped.values.fold<num>(0, (sum, g) => sum + g.sisa);
    final invoices = debts.where((d) => d['supplierId'] == supplierId).toList();
    return ScreenBody(onRefresh: load, children: [
      ScreenHeader('Hutang supplier', 'Total hutang ${rupiah(total)}. Pembayaran dialokasikan ke faktur terlama lebih dulu.'),
      LoadSwitch(loading: loading && debts.isEmpty, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        DataView<MapEntry<int, ({String name, num sisa, int faktur})>>(rows: grouped.entries.toList(),
          emptyTitle: 'Tidak ada hutang supplier', emptyMessage: 'Semua faktur pembelian sudah lunas.',
          onTap: (e) => select(e.key, e.value.name),
          columns: [
            DataCol('Supplier', (e) => e.value.name, flex: 3),
            DataCol('Faktur', (e) => '${e.value.faktur}', numeric: true),
            DataCol('Sisa hutang', (e) => rupiah(e.value.sisa), numeric: true, flex: 2),
          ]),
        if (supplierId != null) ...[
          const SizedBox(height: Space.xl),
          ScreenHeader(section: true, supplierName, 'Sisa ${rupiah(grouped[supplierId]?.sisa ?? 0)}', actions: [
            if ((grouped[supplierId]?.sisa ?? 0) > 0) FilledButton.icon(onPressed: pay, icon: const Icon(Icons.payments_outlined), label: const Text('Bayar')),
            TextButton(onPressed: () => setState(() => supplierId = null), child: const Text('Tutup')),
          ]),
          Text('Faktur belum lunas', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm),
          DataView<Map<String, dynamic>>(rows: invoices, emptyTitle: 'Semua faktur lunas',
            onTap: openInvoice,
            actionsWidth: 200,
            actions: (i) => [
              TextButton(onPressed: () => openInvoice(i), child: const Text('Edit faktur')),
              TextButton(onPressed: () => setSisa(i), child: const Text('Ubah sisa')),
            ],
            columns: [
              DataCol('Faktur', (i) => '#${i['purchaseId']}'),
              DataCol('Tanggal', (i) => text(i['tanggal'])),
              DataCol('Total', (i) => rupiah(i['total']), numeric: true),
              DataCol('Dibayar', (i) => rupiah(i['dibayar']), numeric: true),
              DataCol('Sisa', (i) => rupiah(i['sisa']), numeric: true),
            ]),
          const SizedBox(height: Space.lg),
          Text('Riwayat pembayaran', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm),
          DataView<Map<String, dynamic>>(rows: payments, emptyTitle: 'Belum ada pembayaran',
            actions: (p) => [
              IconButton(tooltip: 'Ubah', onPressed: () => editPayment(p), icon: const Icon(Icons.edit_outlined, size: 20)),
              IconButton(tooltip: 'Hapus', onPressed: () => deletePayment(p), icon: const Icon(Icons.delete_outline, size: 20)),
            ],
            columns: [
              DataCol('Tanggal', (p) => text(p['tanggal'])),
              DataCol('Faktur', (p) => '#${p['purchaseId']}'),
              DataCol('Jumlah', (p) => rupiah(p['jumlah']), numeric: true),
              DataCol('Keterangan', (p) => text(p['keterangan']), flex: 2),
            ]),
        ],
      ])),
    ]);
  }
}

/// Suppliers or customers: the same small master-record screen for both.
class PartiesScreen extends StatefulWidget {
  const PartiesScreen({super.key, required this.api, required this.isAdmin, required this.customers});
  final StoreApi api;
  final bool isAdmin, customers;
  @override State<PartiesScreen> createState() => _PartiesScreenState();
}

class _PartiesScreenState extends State<PartiesScreen> {
  List<Map<String, dynamic>> rows = [];
  String search = '';
  int page = 1, last = 1;
  bool loading = true;
  String? error;
  String get label => widget.customers ? 'pelanggan' : 'supplier';
  @override void initState() { super.initState(); load(); }
  Future<void> load({int target = 1}) async {
    setState(() { loading = true; error = null; });
    try {
      final data = widget.customers ? await widget.api.customerList(search, target) : await widget.api.supplierList(search, target);
      if (mounted) setState(() { rows = jsonRows(data); page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? 1).toInt(); });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> edit([Map<String, dynamic>? row]) async {
    final values = await showFormDialog(context, title: row == null ? 'Tambah $label' : 'Ubah ${row['nama']}', fields: [
      FieldSpec('nama', 'Nama', required: true, initial: row?['nama']),
      FieldSpec('telepon', 'Telepon', initial: row?['telepon']),
      FieldSpec('alamat', 'Alamat', initial: row?['alamat']),
      FieldSpec('keterangan', 'Keterangan', kind: FieldKind.multiline, initial: row?['keterangan']),
    ], onSave: (v) {
      if (row != null) return widget.customers ? widget.api.updateCustomer(idNumber(row['id']), v) : widget.api.updateSupplier(idNumber(row['id']), v);
      return widget.customers ? widget.api.createCustomer(v) : widget.api.createSupplier(v);
    });
    if (values != null && mounted) load(target: page);
  }
  Future<void> remove(Map<String, dynamic> row) async {
    if (!await confirmAction(context, title: 'Hapus ${row['nama']}?', destructive: true, confirmLabel: 'Hapus',
      message: widget.customers ? 'Riwayat penjualannya tetap ada dengan nama yang tercatat saat itu.' : 'Pembelian dari supplier ini tetap ada, tanpa nama supplier.')) { return; }
    if (mounted && await runAction(context, () => widget.customers ? widget.api.deleteCustomer(idNumber(row['id'])) : widget.api.deleteSupplier(idNumber(row['id'])))) load(target: page);
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: () => load(target: page), maxWidth: 1000, children: [
    ScreenHeader(widget.customers ? 'Pelanggan' : 'Supplier', widget.customers ? 'Pelanggan yang dipilih di kasir dan bon.' : 'Pemasok barang untuk pembelian.', actions: [
      FilledButton.icon(onPressed: () => edit(), icon: const Icon(Icons.add), label: Text('Tambah $label')),
    ]),
    SearchBox(onChanged: (v) { search = v; load(); }, hint: 'Cari nama $label'),
    const SizedBox(height: Space.md),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    LoadSwitch(loading: false, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows, onTap: edit,
      actions: widget.isAdmin ? (r) => [IconButton(tooltip: 'Hapus', onPressed: () => remove(r), icon: const Icon(Icons.delete_outline, size: 20))] : null,
      columns: [
        DataCol('Nama', (r) => text(r['nama']), flex: 2),
        DataCol('Telepon', (r) => text(r['telepon'])),
        DataCol('Alamat', (r) => text(r['alamat']), flex: 2),
        DataCol(widget.customers ? 'Transaksi' : 'Pembelian', (r) => text(r[widget.customers ? 'saleCount' : 'purchaseCount'], '0'), numeric: true),
      ])),
    Pager(page: page, last: last, busy: loading, onPage: (p) => load(target: p)),
  ]);
}
