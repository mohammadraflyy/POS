import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/barcode_burst.dart';
import '../../services/business_api.dart';
import '../../services/draft_store.dart';
import '../../services/mutation_guard.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveSupplierScreen.dart';
import 'LivePurchaseItemScreen.dart';
class LivePurchaseScreen extends StatefulWidget {
  const LivePurchaseScreen({super.key, required this.api, required this.guard, this.onSaved, this.active = true, this.editing, this.drafts});

  /// A saved purchase to change: its id, supplier, date, note, lines and down payment.
  final PurchaseEdit? editing;
  final BusinessApi api;
  final MutationGuard guard;
  final VoidCallback? onSaved;
  final DraftStore? drafts;

  /// False while another menu is showing, so a scan there does not land in this purchase.
  final bool active;
  @override State<LivePurchaseScreen> createState() => _LivePurchaseScreenState();
}
/// A saved purchase loaded into the form.
class PurchaseEdit {
  const PurchaseEdit({required this.id, required this.supplier, required this.date, required this.note, required this.items, required this.downPayment});
  final int id;
  final Map<String, dynamic>? supplier;
  final DateTime date;
  final String note;
  final List<PurchaseDraftItem> items;
  final num downPayment;

  /// From GET /v1/purchases/:id; [supplierName] comes from the list it was opened from.
  factory PurchaseEdit.fromDetail(Map<String, dynamic> d, {String? supplierName}) {
    final lines = <PurchaseDraftItem>[];
    for (final raw in (d['items'] as List? ?? const []).whereType<Map>()) {
      final i = Map<String, dynamic>.from(raw);
      final units = [LiveUnit(null, i['baseSatuan']?.toString() ?? 'Satuan dasar', null),
        for (final u in (i['units'] as List? ?? const []).whereType<Map>()) LiveUnit(idNumber(u['id']), u['satuan']?.toString() ?? '', number(u['hargaJual']))];
      final product = LiveProduct(idNumber(i['productId']), i['namaItem']?.toString() ?? '', i['kodeItem']?.toString() ?? '', null, units);
      final unitId = i['productUnitId'] == null ? null : idNumber(i['productUnitId']);
      lines.add(PurchaseDraftItem(product, units.firstWhere((u) => u.id == unitId, orElse: () => units.first), number(i['qty']) ?? 1, number(i['hargaBeli']) ?? 0));
    }
    return PurchaseEdit(id: idNumber(d['id']), supplier: d['supplierId'] == null ? null : {'id': d['supplierId'], 'nama': supplierName ?? 'Supplier #${d['supplierId']}'},
      date: DateTime.tryParse(d['tanggal']?.toString() ?? '') ?? DateTime.now(), note: d['catatan']?.toString() ?? '', items: lines, downPayment: number(d['uangMuka']) ?? 0);
  }
}

class _LivePurchaseScreenState extends State<LivePurchaseScreen> {
  Map<String, dynamic>? supplier;
  DateTime date = DateTime.now();
  final note = TextEditingController(), paid = TextEditingController();
  final List<PurchaseDraftItem> items = [];
  bool saving = false;
  String? error, success;
  final scanner = BarcodeBurst();
  late final DraftStore? _drafts = widget.editing == null ? (widget.drafts ?? DraftStore.forDevice('pembelian')) : null;
  Timer? _draftTimer;

  @override void initState() {
    super.initState();
    final e = widget.editing;
    if (e != null) {
      supplier = e.supplier; date = e.date; note.text = e.note; items.addAll(e.items);
      paid.text = e.downPayment == e.downPayment.roundToDouble() ? e.downPayment.toInt().toString() : e.downPayment.toString();
    } else {
      note.addListener(_saveDraft);
      paid.addListener(_saveDraft);
      _restoreDraft();
    }
    HardwareKeyboard.instance.addHandler(handleKey);
  }
  @override void dispose() {
    if (_draftTimer?.isActive ?? false) { _draftTimer!.cancel(); _writeDraft(); }
    HardwareKeyboard.instance.removeHandler(handleKey);
    note.dispose();
    paid.dispose();
    super.dispose();
  }

  void _saveDraft() {
    if (_drafts == null) return;
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 350), _writeDraft);
  }

  Future<void> _writeDraft() async {
    final store = _drafts;
    if (store == null) return;
    try {
      if (items.isEmpty && supplier == null && note.text.trim().isEmpty && paid.text.trim().isEmpty) {
        await store.clear();
        return;
      }
      await store.write(jsonEncode({
        'supplier': supplier,
        'date': isoDate(date),
        'note': note.text,
        'paid': paid.text,
        'items': [
          for (final i in items)
            {
              'product': {
                'id': i.product.id,
                'name': i.product.name,
                'code': i.product.code,
                'units': [
                  for (final u in i.product.units)
                    {'id': u.id, 'name': u.name, 'price': u.price, 'cost': u.cost, 'conversionFactor': u.conversionFactor},
                ],
              },
              'unitId': i.unit.id,
              'qty': i.quantity,
              'price': i.price,
              'sellPrice': i.sellPrice,
            },
        ],
      }));
    } catch (_) {}
  }

  Future<void> _restoreDraft() async {
    try {
      final raw = await _drafts?.read();
      if (raw == null || raw.isEmpty || !mounted) return;
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final restoredItems = <PurchaseDraftItem>[];
      for (final entry in (data['items'] as List? ?? const []).whereType<Map>()) {
        final p = Map<String, dynamic>.from(entry['product'] as Map);
        final units = [
          for (final u in (p['units'] as List? ?? const []).whereType<Map>())
            LiveUnit(u['id'] as int?, u['name'] as String, u['price'] as num?, cost: u['cost'] as num?, conversionFactor: (u['conversionFactor'] as int?) ?? 1),
        ];
        final prod = LiveProduct(p['id'] as int, p['name'] as String, p['code'] as String? ?? '', null, units);
        final unit = units.firstWhere((u) => u.id == entry['unitId'], orElse: () => units.first);
        restoredItems.add(PurchaseDraftItem(prod, unit, entry['qty'] as num, entry['price'] as num, sellPrice: entry['sellPrice'] as num?));
      }
      if (!mounted) return;
      setState(() {
        if (data['supplier'] is Map) supplier = Map<String, dynamic>.from(data['supplier'] as Map);
        if (data['date'] is String) date = DateTime.tryParse(data['date'] as String) ?? date;
        note.text = data['note']?.toString() ?? '';
        paid.text = data['paid']?.toString() ?? '';
        items..clear()..addAll(restoredItems);
      });
    } catch (_) {
      await _drafts?.clear();
    }
  }

  /// A scanner fired while no text field had focus, as on the desktop's purchase page.
  bool handleKey(KeyEvent event) {
    if (!mounted || !widget.active || saving || ModalRoute.of(context)?.isCurrent == false) return false;
    if (FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null) return false;
    final scan = scanner.feed(event);
    if (scan.code == null) return false;
    addScanned(scan.code!);
    return true;
  }

  Future<void> addScanned(String code) async {
    try {
      final product = await widget.api.purchaseBarcode(code);
      if (!mounted) return;
      await addItem(initialProduct: product);
    } catch (e) { if (mounted) showError(context, e); }
  }

  Future<void> addItem({LiveProduct? initialProduct}) async {
    final item = await Navigator.of(context).push<PurchaseDraftItem>(MaterialPageRoute(builder: (_) => LivePurchaseItemScreen(api: widget.api, initialProduct: initialProduct)));
    if (mounted && item != null) { setState(() { items.add(item); success = null; }); _saveDraft(); }
  }
  Future<void> editItem(int index) async {
    final updated = await editPurchaseItem(context, items[index]);
    if (mounted && updated != null) { setState(() { items[index] = updated; success = null; }); _saveDraft(); }
  }

  Future<void> loadLowStockSuggestions() async {
    try {
      final res = await widget.api.products('', 1, pageSize: 50, stockFilter: 'warning');
      final list = jsonRows(res);
      if (!mounted) return;
      if (list.isEmpty) {
        showNotice(context, 'Tidak ada produk yang stoknya menipis saat ini.', kind: NoticeKind.info);
        return;
      }
      var added = 0;
      final existingIds = items.map((i) => i.product.id).toSet();
      for (final p in list) {
        final pid = idNumber(p['id']);
        if (existingIds.contains(pid)) continue;
        final units = [
          LiveUnit(null, p['satuan']?.toString() ?? 'PCS', number(p['hargaJual']), cost: number(p['hargaPokok'])),
        ];
        final prod = LiveProduct(pid, p['namaItem']?.toString() ?? '', p['kodeItem']?.toString() ?? '', number(p['stok']), units);
        items.add(PurchaseDraftItem(
          prod,
          units.first,
          10,
          number(p['hargaPokok']) ?? 0,
          sellPrice: number(p['hargaJual']),
        ));
        added++;
      }
      if (added > 0) {
        setState(() {});
        _saveDraft();
        showNotice(context, '$added produk dengan stok menipis dimasukkan ke daftar pembelian.', kind: NoticeKind.success);
      } else {
        showNotice(context, 'Semua produk yang stoknya menipis sudah ada di daftar pembelian.', kind: NoticeKind.info);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }
  Future<void> save() async {
    if (saving) return; setState(() { saving = true; error = null; success = null; });
    try {
      if (items.isEmpty) throw const FormatException('Tambahkan minimal satu barang.');
      final upfront = paid.text.trim().isEmpty ? null : inputRupiah(paid.text);
      if (upfront != null && upfront != upfront.round()) throw const FormatException('Uang muka harus rupiah bulat.');
      final body = <String, dynamic>{'supplierId': supplier == null ? null : idNumber(supplier!['id'] ?? supplier!['supplierId']),
        'tanggal': isoDate(date), 'catatan': note.text.trim().isEmpty ? null : note.text.trim(),
        'items': items.map((i) => i.toJson()).toList(), if (upfront != null) 'dibayar': upfront};
      final editing = widget.editing;
      final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
        title: Text(editing == null ? 'Simpan pembelian ke PC?' : 'Simpan perubahan pembelian #${editing.id}?'),
        content: Text(editing == null ? '${items.length} baris barang masuk akan dicatat. Stok dan harga pokok diperbarui oleh PC.'
          : 'Barang lama dikembalikan dulu, lalu ${items.length} baris ini dicatat ulang. Stok, harga pokok, dan sisa hutang dihitung ulang oleh PC.'),
        actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Periksa lagi')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Simpan'))]));
      if (confirmed != true) return;
      final result = await widget.guard.run(editing == null ? 'Pembelian' : 'Ubah pembelian #${editing.id}',
        () => editing == null ? widget.api.purchase(body) : widget.api.request('/v1/purchases/${editing.id}', method: 'PUT', body: body));
      if (editing != null) { if (mounted) { widget.onSaved?.call(); Navigator.of(context).pop(true); } return; }
      if (mounted) widget.onSaved?.call();
      _draftTimer?.cancel();
      await _drafts?.clear();
      if (mounted) setState(() { items.clear(); paid.clear(); note.clear(); supplier = null; success = 'Pembelian berhasil disimpan di PC${result is Map && result['purchaseId'] != null ? ' (#${result['purchaseId']})' : ''}.'; });
      if (mounted && success != null) showNotice(context, success!, kind: NoticeKind.success);
    } catch (e) { if (mounted) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: widget.guard, builder: (context, _) {
    final enabled = !saving && !widget.guard.busy && widget.guard.pending == null;
    return ListView(padding: const EdgeInsets.all(Space.lg), children: [
      PageIntro(widget.editing == null ? 'Pembelian baru' : 'Ubah pembelian #${widget.editing!.id}',
        widget.editing == null ? 'Barang yang disimpan akan menambah stok toko.' : 'Ubah supplier, tanggal, barang, atau uang muka, lalu simpan.'),
      WhitePanel(padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.xs), child: Column(children: [ListTile(contentPadding: EdgeInsets.zero, leading: Icon(Icons.local_shipping_outlined, color: muted), title: Text(supplier == null ? 'Pilih supplier (opsional)' : (supplier!['nama'] ?? supplier!['name']).toString()), trailing: const Icon(Icons.chevron_right), onTap: !enabled ? null : () async {
        final result = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => LiveSupplierScreen(api: widget.api, guard: widget.guard)));
        if (mounted && result != null) { setState(() => supplier = result); _saveDraft(); }
      }), if (supplier != null) Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: enabled ? () { setState(() => supplier = null); _saveDraft(); } : null, child: const Text('Tanpa supplier'))),
        const Divider(),
        ListTile(contentPadding: EdgeInsets.zero, leading: Icon(Icons.calendar_today_outlined, color: muted), title: const Text('Tanggal faktur'),
          trailing: Text(isoDate(date), style: amountStyle.copyWith(fontSize: 14)),
          onTap: !enabled ? null : () async { final selected = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2000), lastDate: DateTime.now()); if (selected != null && mounted) { setState(() => date = selected); _saveDraft(); } }),
      ])), const SizedBox(height: Space.lg),
      for (var i = 0; i < items.length; i++) Padding(padding: const EdgeInsets.only(bottom: 10), child: WhitePanel(padding: EdgeInsets.zero, child: ListTile(
        onTap: enabled ? () => editItem(i) : null,
        title: Text(items[i].product.name),
        subtitle: Text('${quantityText(items[i].quantity)} ${items[i].unit.name}${items[i].unit.conversionFactor > 1 ? ' (isi ${items[i].unit.conversionFactor})' : ''} × ${rupiah(items[i].price)} = ${rupiah(items[i].quantity * items[i].price)}${items[i].sellPrice == null ? '' : ' · jual jadi ${rupiah(items[i].sellPrice)}'}'),
        trailing: IconButton(tooltip: 'Hapus barang pembelian', onPressed: enabled ? () { setState(() => items.removeAt(i)); _saveDraft(); } : null, icon: const Icon(Icons.close)),
      ))),
      Wrap(
        spacing: Space.sm,
        runSpacing: Space.sm,
        children: [
          OutlinedButton.icon(onPressed: !enabled ? null : () => addItem(), icon: const Icon(Icons.add), label: const Text('Tambah barang  ·  atau scan barcode')),
          if (widget.editing == null)
            OutlinedButton.icon(onPressed: !enabled ? null : loadLowStockSuggestions, icon: const Icon(Icons.auto_awesome), label: const Text('Muat stok menipis')),
        ],
      ),
      if (items.isNotEmpty) ...[
        const SizedBox(height: Space.md),
        WhitePanel(
          padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Total Pembelian', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              Text(rupiah(items.fold<num>(0, (sum, i) => sum + (i.quantity * i.price))),
                  style: amountStyle.copyWith(fontSize: 18, fontWeight: FontWeight.bold, color: primaryInk)),
            ],
          ),
        ),
      ],
      const SizedBox(height: Space.lg), TextField(controller: paid, enabled: enabled, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Uang muka (opsional, Rp)', helperText: 'Kosong = lunas. Isi 0 untuk utang penuh.')),
      const SizedBox(height: Space.lg), TextField(controller: note, enabled: enabled, decoration: const InputDecoration(labelText: 'Catatan (opsional)')),
      const SizedBox(height: 16), Text('Jumlah akhir dihitung oleh PC saat penyimpanan.', style: TextStyle(color: muted, fontSize: 13)),
      if (error != null) Text(error!, style: TextStyle(color: errorColor)), if (success != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(success!, style: TextStyle(color: successColor))),
      const SizedBox(height: Space.lg), FilledButton.icon(onPressed: enabled && items.isNotEmpty && widget.guard.ready ? save : null, icon: const Icon(Icons.save_outlined), label: Text(saving ? 'Menyimpan…' : items.isEmpty ? 'Tambah barang dulu untuk menyimpan' : widget.editing == null ? 'Simpan pembelian ke PC' : 'Simpan perubahan')),
    ]);
  });
}
