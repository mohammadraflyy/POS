import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';

/// Lowest selling price in rupiah that leaves [marginPersen]% margin on selling price,
/// rounded up to the nearest Rp 100 (matching desktop-node lib/harga.ts).
int hargaJualRekomendasi(num hargaPokok, num marginPersen) {
  if (!hargaPokok.isFinite || hargaPokok <= 0) return 0;
  final m = (marginPersen.isFinite ? marginPersen : 0).clamp(0, 90);
  return ((hargaPokok / (1 - m / 100)) / 100).ceil() * 100;
}

String marginLabel(num? pokok, num? jual) {
  if (pokok == null || jual == null || pokok <= 0 || jual <= 0) return '—';
  final pct = ((jual - pokok) / jual * 100).round();
  return jual < pokok ? '$pct% (di bawah modal)' : '$pct%';
}

/// One product's units (with their costs and prices), price tiers, and price history.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.api, required this.productId, required this.isAdmin});
  final StoreApi api;
  final int productId;
  final bool isAdmin;
  @override State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Map<String, dynamic>? detail;
  List<Map<String, dynamic>> masterUnits = [];
  int marginMinimalPersen = 10;
  bool loading = true;
  String? error;
  int get id => widget.productId;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = detail == null; error = null; });
    try {
      final data = await widget.api.product(id);
      final units = widget.isAdmin ? await widget.api.units() : <Map<String, dynamic>>[];
      int margin = marginMinimalPersen;
      try {
        final s = await widget.api.settings();
        margin = (number(s['marginMinimalPersen']) ?? 10).round();
      } catch (_) {}
      if (mounted) setState(() { detail = data; masterUnits = units; marginMinimalPersen = margin; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  List<Map<String, dynamic>> get units => detail == null ? const [] : jsonRows(detail!['units']);

  /// Excludes [selfId] and any unit whose parent chain leads through [selfId].
  List<Map<String, dynamic>> _validParentUnits(Object? selfId) {
    if (selfId == null) return units;
    final excluded = <Object?>{selfId};
    var added = true;
    while (added) {
      added = false;
      for (final u in units) {
        if (!excluded.contains(u['id']) && excluded.contains(u['parentUnitId'])) {
          excluded.add(u['id']);
          added = true;
        }
      }
    }
    return units.where((u) => !excluded.contains(u['id'])).toList();
  }

  Future<void> editUnit([Map<String, dynamic>? unit]) async {
    final isBase = unit?['isBaseUnit'] == true;
    final parents = _validParentUnits(unit?['id']);
    final baseUnit = units.firstWhere((u) => u['isBaseUnit'] == true, orElse: () => {'id': null, 'hargaPokok': 0});
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _UnitFormDialog(
        api: widget.api,
        productId: id,
        unit: unit,
        isBase: isBase,
        masterUnits: masterUnits.where((m) => m['isActive'] != false).toList(),
        parents: parents,
        baseUnit: baseUnit,
        marginMinimalPersen: marginMinimalPersen,
      ),
    );
    if (saved == true && mounted) load();
  }

  Future<void> deleteUnit(Map<String, dynamic> unit) async {
    if (!await confirmAction(context, title: 'Hapus satuan ${unit['satuan']}?', destructive: true, confirmLabel: 'Hapus',
      message: 'Satuan lain yang diukur dengan satuan ini ikut terhapus, begitu juga harga bertingkatnya.')) { return; }
    if (mounted && await runAction(context, () => widget.api.deleteUnit(id, idNumber(unit['id'])))) load();
  }

  Future<void> addTier() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _TierFormDialog(
        api: widget.api,
        productId: id,
        units: units,
        marginMinimalPersen: marginMinimalPersen,
      ),
    );
    if (saved == true && mounted) load();
  }

  @override Widget build(BuildContext context) {
    final tiers = detail == null ? const <Map<String, dynamic>>[] : jsonRows(detail!['priceTiers']);
    final history = detail == null ? const <Map<String, dynamic>>[] : jsonRows(detail!['priceHistory']);
    String unitName(Object? unitRowId) => units.firstWhere((u) => u['id'] == unitRowId, orElse: () => {'satuan': '—'})['satuan'].toString();
    return Scaffold(appBar: AppBar(title: Text(detail?['namaItem']?.toString() ?? 'Produk')), body: ScreenBody(onRefresh: load, maxWidth: 1000, children: [
      LoadSwitch(loading: loading, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ScreenHeader(section: true, 'Satuan', 'Kode ${detail?['kodeItem'] ?? ''}. Harga pokok tiap satuan ikut bergerak saat pembelian.', actions: [
          if (widget.isAdmin) FilledButton.icon(onPressed: () => editUnit(), icon: const Icon(Icons.add), label: const Text('Tambah satuan')),
        ]),
        DataView<Map<String, dynamic>>(rows: units, onTap: widget.isAdmin ? editUnit : null,
          actions: widget.isAdmin ? (u) => [if (u['isBaseUnit'] != true) IconButton(tooltip: 'Hapus satuan', onPressed: () => deleteUnit(u), icon: const Icon(Icons.delete_outline, size: 20))] : null,
          columns: [
            DataCol('Satuan', (u) => '${u['satuan']}${u['isBaseUnit'] == true ? ' (dasar)' : ''}', flex: 2),
            DataCol('Isi', (u) => u['isBaseUnit'] == true ? '1' : '${u['konversi']} ${unitName(units.firstWhere((x) => x['isBaseUnit'] == true, orElse: () => {})['id'])}', numeric: true),
            DataCol('Harga pokok', (u) => rupiah(u['hargaPokok']), numeric: true, flex: 2),
            DataCol('Harga jual', (u) => rupiah(u['hargaJual']), numeric: true, flex: 2),
            DataCol('Margin', (u) => marginLabel(number(u['hargaPokok']), number(u['hargaJual'])), numeric: true, flex: 2),
          ]),
        const SizedBox(height: Space.xl),
        ScreenHeader(section: true, 'Harga bertingkat', 'Harga khusus saat membeli dalam jumlah tertentu.', actions: [
          if (widget.isAdmin && units.isNotEmpty) OutlinedButton.icon(onPressed: addTier, icon: const Icon(Icons.add), label: const Text('Tambah harga')),
        ]),
        DataView<Map<String, dynamic>>(rows: tiers, emptyTitle: 'Belum ada harga bertingkat',
          actions: widget.isAdmin ? (t) => [IconButton(tooltip: 'Hapus harga', onPressed: () async {
            if (await runAction(context, () => widget.api.deleteTier(id, idNumber(t['id'])))) load();
          }, icon: const Icon(Icons.delete_outline, size: 20))] : null,
          columns: [
            DataCol('Satuan', (t) => unitName(t['productUnitId'])),
            DataCol('Qty', (t) => t['maxQty'] == null ? '≥ ${t['minQty']}' : '${t['minQty']} – ${t['maxQty']}'),
            DataCol('Harga', (t) => rupiah(t['hargaJual']), numeric: true),
            DataCol('Margin', (t) {
              final u = units.firstWhere((x) => x['id'] == t['productUnitId'], orElse: () => {});
              return marginLabel(number(u['hargaPokok']), number(t['hargaJual']));
            }, numeric: true),
          ]),
        const SizedBox(height: Space.xl),
        Text('Riwayat harga', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm),
        DataView<Map<String, dynamic>>(rows: history, emptyTitle: 'Belum ada perubahan harga', columns: [
          DataCol('Waktu', (h) => dateTimeLabel(h['createdAt']), flex: 2),
          DataCol('Pokok', (h) => '${rupiah(h['hargaPokokLama'])} → ${rupiah(h['hargaPokokBaru'])}', flex: 3),
          DataCol('Jual', (h) => '${rupiah(h['hargaJualLama'])} → ${rupiah(h['hargaJualBaru'])}', flex: 3),
          DataCol('Oleh', (h) => text(h['userName'], 'Pembelian')),
        ]),
      ])),
    ]));
  }
}

class _UnitFormDialog extends StatefulWidget {
  const _UnitFormDialog({
    required this.api,
    required this.productId,
    required this.unit,
    required this.isBase,
    required this.masterUnits,
    required this.parents,
    required this.baseUnit,
    required this.marginMinimalPersen,
  });
  final StoreApi api;
  final int productId;
  final Map<String, dynamic>? unit;
  final bool isBase;
  final List<Map<String, dynamic>> masterUnits;
  final List<Map<String, dynamic>> parents;
  final Map<String, dynamic> baseUnit;
  final int marginMinimalPersen;

  @override
  State<_UnitFormDialog> createState() => _UnitFormDialogState();
}

class _UnitFormDialogState extends State<_UnitFormDialog> {
  late Object? unitId = widget.unit?['unitId'] ?? (widget.masterUnits.isNotEmpty ? widget.masterUnits.first['id'] : null);
  late Object? parentUnitId = widget.unit?['parentUnitId'] ?? widget.baseUnit['id'];
  late final kemasan = TextEditingController(text: widget.unit?['jumlahKemasan']?.toString() ?? '');
  late final hargaJual = TextEditingController(text: _plain(widget.unit?['hargaJual']));
  late final hargaPokok = TextEditingController(text: _plain(widget.unit?['hargaPokok']));
  bool saving = false;
  String? error;

  static String _plain(Object? v) {
    final n = number(v);
    return n == null ? '' : (n == n.roundToDouble() ? n.toInt().toString() : n.toString());
  }

  @override
  void dispose() {
    kemasan.dispose();
    hargaJual.dispose();
    hargaPokok.dispose();
    super.dispose();
  }

  num get _autoPokok {
    if (widget.isBase) return number(widget.unit?['hargaPokok']) ?? 0;
    final parent = widget.parents.firstWhere((u) => u['id'] == parentUnitId, orElse: () => widget.baseUnit);
    final parentConv = number(parent['konversi']) ?? 1;
    final qty = int.tryParse(kemasan.text.trim()) ?? 0;
    final basePokok = number(widget.baseUnit['hargaPokok']) ?? 0;
    return qty > 0 ? basePokok * parentConv * qty : 0;
  }

  num get _effectivePokok {
    if (widget.isBase) return number(widget.unit?['hargaPokok']) ?? 0;
    final typed = hargaPokok.text.trim();
    if (typed.isNotEmpty) {
      try { return inputRupiah(typed); } catch (_) {}
    }
    return _autoPokok;
  }

  Future<void> _submit() async {
    setState(() { saving = true; error = null; });
    try {
      final jual = inputRupiah(hargaJual.text);
      if (widget.isBase) {
        await widget.api.updateUnit(widget.productId, idNumber(widget.unit!['id']), {
          'unitId': widget.unit!['unitId'],
          'jumlahKemasan': 1,
          'hargaJual': jual,
        });
      } else {
        if (unitId == null) throw const FormatException('Satuan wajib dipilih.');
        final isi = int.tryParse(kemasan.text.trim());
        if (isi == null || isi <= 0) throw const FormatException('Isi per satuan wajib berupa angka bulat > 0.');
        final body = <String, dynamic>{
          'unitId': unitId,
          'parentUnitId': parentUnitId,
          'jumlahKemasan': isi,
          'hargaJual': jual,
          if (hargaPokok.text.trim().isNotEmpty) 'hargaPokok': inputRupiah(hargaPokok.text),
        };
        if (widget.unit == null) {
          await widget.api.addUnit(widget.productId, body);
        } else {
          await widget.api.updateUnit(widget.productId, idNumber(widget.unit!['id']), body);
        }
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { saving = false; error = errorText(e); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final pokok = _effectivePokok;
    final rekom = hargaJualRekomendasi(pokok, widget.marginMinimalPersen);
    num? currentJual;
    try { if (hargaJual.text.trim().isNotEmpty) currentJual = inputRupiah(hargaJual.text); } catch (_) {}
    return AlertDialog(
      title: Text(widget.unit == null ? 'Tambah satuan' : 'Ubah satuan ${widget.unit!['satuan']}'),
      content: SizedBox(width: 440, child: SingleChildScrollView(child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!widget.isBase) ...[
            DropdownButtonFormField<Object?>(
              value: unitId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Satuan'),
              items: [for (final m in widget.masterUnits) DropdownMenuItem(value: m['id'], child: Text('${m['code']} — ${m['name']}'))],
              onChanged: (v) => setState(() => unitId = v),
            ),
            const SizedBox(height: Space.md),
            DropdownButtonFormField<Object?>(
              value: parentUnitId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Berisi satuan', helperText: 'Contoh: 1 DUS berisi 12 PCS'),
              items: [for (final u in widget.parents) DropdownMenuItem(value: u['id'], child: Text(u['satuan'].toString()))],
              onChanged: (v) => setState(() => parentUnitId = v),
            ),
            const SizedBox(height: Space.md),
            TextField(
              controller: kemasan,
              keyboardType: TextInputType.number,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Isi per satuan'),
            ),
            const SizedBox(height: Space.md),
          ],
          TextField(
            controller: hargaJual,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Harga jual'),
          ),
          if (rekom > 0) Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              Expanded(child: Text(
                'Rekomendasi ${rupiah(rekom)} (margin minimal ${widget.marginMinimalPersen}%) · Margin saat ini: ${marginLabel(pokok, currentJual)}',
                style: TextStyle(fontSize: 12, color: currentJual != null && currentJual < pokok ? errorColor : muted),
              )),
              TextButton(
                onPressed: () => setState(() => hargaJual.text = rekom.toString()),
                child: const Text('Pakai'),
              ),
            ]),
          ),
          if (!widget.isBase) ...[
            const SizedBox(height: Space.md),
            TextField(
              controller: hargaPokok,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Harga pokok',
                hintText: _autoPokok > 0 ? 'Otomatis ${rupiah(_autoPokok)}' : null,
                helperText: 'Kosongkan untuk dihitung otomatis dari harga pokok dasar',
              ),
            ),
          ],
          if (error != null) Padding(padding: const EdgeInsets.only(top: Space.md), child: Text(error!, style: TextStyle(color: errorColor))),
        ],
      ))),
      actions: [
        TextButton(onPressed: saving ? null : () => Navigator.pop(context), child: const Text('Batal')),
        FilledButton(onPressed: saving ? null : _submit, child: Text(saving ? 'Menyimpan…' : 'Simpan')),
      ],
    );
  }
}

class _TierFormDialog extends StatefulWidget {
  const _TierFormDialog({
    required this.api,
    required this.productId,
    required this.units,
    required this.marginMinimalPersen,
  });
  final StoreApi api;
  final int productId;
  final List<Map<String, dynamic>> units;
  final int marginMinimalPersen;

  @override
  State<_TierFormDialog> createState() => _TierFormDialogState();
}

class _TierFormDialogState extends State<_TierFormDialog> {
  late Object? productUnitId = widget.units.first['id'];
  final minQty = TextEditingController();
  final maxQty = TextEditingController();
  final hargaJual = TextEditingController();
  bool saving = false;
  String? error;

  @override
  void dispose() {
    minQty.dispose();
    maxQty.dispose();
    hargaJual.dispose();
    super.dispose();
  }

  num get _pokok {
    final u = widget.units.firstWhere((x) => x['id'] == productUnitId, orElse: () => widget.units.first);
    return number(u['hargaPokok']) ?? 0;
  }

  Future<void> _submit() async {
    setState(() { saving = true; error = null; });
    try {
      final min = int.tryParse(minQty.text.trim());
      if (min == null || min <= 0) throw const FormatException('Qty minimal wajib diisi.');
      final max = maxQty.text.trim().isEmpty ? null : int.tryParse(maxQty.text.trim());
      final jual = inputRupiah(hargaJual.text);
      await widget.api.addTier(widget.productId, {
        'productUnitId': productUnitId,
        'minQty': min,
        'maxQty': max,
        'hargaJual': jual,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { saving = false; error = errorText(e); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final pokok = _pokok;
    final rekom = hargaJualRekomendasi(pokok, widget.marginMinimalPersen);
    num? currentJual;
    try { if (hargaJual.text.trim().isNotEmpty) currentJual = inputRupiah(hargaJual.text); } catch (_) {}
    return AlertDialog(
      title: const Text('Harga bertingkat'),
      content: SizedBox(width: 440, child: SingleChildScrollView(child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<Object?>(
            value: productUnitId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Satuan'),
            items: [for (final u in widget.units) DropdownMenuItem(value: u['id'], child: Text(u['satuan'].toString()))],
            onChanged: (v) => setState(() => productUnitId = v),
          ),
          const SizedBox(height: Space.md),
          TextField(controller: minQty, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Qty minimal')),
          const SizedBox(height: Space.md),
          TextField(controller: maxQty, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Qty maksimal', helperText: 'Kosongkan bila tanpa batas')),
          const SizedBox(height: Space.md),
          TextField(
            controller: hargaJual,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Harga jual per satuan'),
          ),
          if (rekom > 0) Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              Expanded(child: Text(
                'Rekomendasi ${rupiah(rekom)} (margin minimal ${widget.marginMinimalPersen}%) · Margin: ${marginLabel(pokok, currentJual)}',
                style: TextStyle(fontSize: 12, color: currentJual != null && currentJual < pokok ? errorColor : muted),
              )),
              TextButton(
                onPressed: () => setState(() => hargaJual.text = rekom.toString()),
                child: const Text('Pakai'),
              ),
            ]),
          ),
          if (error != null) Padding(padding: const EdgeInsets.only(top: Space.md), child: Text(error!, style: TextStyle(color: errorColor))),
        ],
      ))),
      actions: [
        TextButton(onPressed: saving ? null : () => Navigator.pop(context), child: const Text('Batal')),
        FilledButton(onPressed: saving ? null : _submit, child: Text(saving ? 'Menyimpan…' : 'Simpan')),
      ],
    );
  }
}
