import 'dart:async';
import 'package:flutter/material.dart';
import '../../services/business_api.dart';
import '../../services/mutation_guard.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
class LiveOpnameScreen extends StatefulWidget {
  const LiveOpnameScreen({super.key, required this.api, required this.guard, this.onSaved});
  final BusinessApi api;
  final MutationGuard guard;
  final VoidCallback? onSaved;
  @override State<LiveOpnameScreen> createState() => _LiveOpnameScreenState();
}
class _LiveOpnameScreenState extends State<LiveOpnameScreen> {
  List<Map<String, dynamic>> categories = [], rows = [];
  final selected = <int>{};
  String query = '';
  bool loading = false;
  String? error, categoryError;
  int serial = 0;
  Timer? timer;
  @override void initState() { super.initState(); loadCategories(); }
  @override void dispose() { timer?.cancel(); super.dispose(); }
  Future<void> loadCategories() async {
    try { final result = await widget.api.categories(); for (final c in result) { idNumber(c['id']); }
      if (mounted) setState(() { categories = result; categoryError = null; });
    } catch (e) { if (mounted) { setState(() => categoryError = e.toString()); showError(context, e); } }
  }
  Future<void> load() async {
    final n = ++serial;
    if (query.trim().isEmpty && selected.isEmpty) { setState(() { rows = []; loading = false; error = null; }); return; }
    setState(() { loading = true; error = null; });
    try { final result = await widget.api.opname(query.trim(), Set.of(selected)); if (mounted && n == serial) setState(() => rows = result); }
    catch (e) { if (mounted && n == serial) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted && n == serial) setState(() => loading = false); }
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: widget.guard, builder: (context, _) => ListView(padding: const EdgeInsets.all(Space.lg), children: [
    const PageIntro('Periksa stok', 'Koreksi hanya jika jumlah barang berbeda. Gunakan satuan dasar.'),
    TextField(onChanged: (v) { query = v; serial++; timer?.cancel(); setState(() => loading = true); timer = Timer(const Duration(milliseconds: 350), load); }, decoration: const InputDecoration(labelText: 'Pencarian', hintText: 'Cari nama, kode, barcode, atau kategori', prefixIcon: Icon(Icons.search))),
    const SizedBox(height: 12), if (categoryError != null) TextButton(onPressed: loadCategories, child: const Text('Muat ulang kategori')),
    Wrap(spacing: 8, runSpacing: 8, children: [for (final c in categories) FilterChip(label: Text((c['nama'] ?? c['name'] ?? '').toString()), selected: selected.contains(idNumber(c['id'])), onSelected: (value) { final id = idNumber(c['id']); if (value) { selected.add(id); } else { selected.remove(id); } load(); })]),
    const SizedBox(height: 16), if (loading) const Center(child: CircularProgressIndicator())
    else if (error != null) EmptyPanel(icon: Icons.wifi_off, title: 'Data belum dimuat', message: error!, action: TextButton(onPressed: load, child: const Text('Coba lagi')))
    else if (rows.isEmpty) const EmptyPanel(icon: Icons.manage_search, title: 'Pilih kategori atau cari produk', message: 'Produk aktif sesuai pencarian akan ditampilkan di sini.')
    else for (final row in rows) RecordRow(
      title: (row['namaItem'] ?? row['name'] ?? 'Produk').toString(),
      subtitle: (row['kodeItem'] ?? '').toString(),
      value: 'Stok ' + quantityText(row['stok']) + ' ' + (row['satuan'] ?? '').toString(),
      actionLabel: 'Koreksi stok',
      onTap: !widget.guard.ready || widget.guard.busy || widget.guard.pending != null ? null : () async {
        final saved = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => _AdjustmentSheet(api: widget.api, guard: widget.guard, product: row));
        if (mounted && saved == true) { widget.onSaved?.call(); load(); }
      },
    ),
  ]));
}
class _AdjustmentSheet extends StatefulWidget {
  const _AdjustmentSheet({required this.api, required this.guard, required this.product});
  final BusinessApi api;
  final MutationGuard guard;
  final Map<String, dynamic> product;
  @override State<_AdjustmentSheet> createState() => _AdjustmentSheetState();
}
class _AdjustmentSheetState extends State<_AdjustmentSheet> {
  final actual = TextEditingController(), reason = TextEditingController();
  bool saving = false;
  String? error;
  @override void dispose() { actual.dispose(); reason.dispose(); super.dispose(); }
  Future<void> save() async {
    if (saving) return; setState(() { saving = true; error = null; });
    try {
      final after = inputQty(actual.text, zero: true);
      if (reason.text.length > 255) throw const FormatException('Alasan maksimal 255 karakter.');
      final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Terapkan hasil hitung?'), content: Text('Stok di PC akan ditetapkan menjadi ${quantityText(after)} ${widget.product['satuan'] ?? ''}. Harga pokok tidak berubah.'), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Periksa lagi')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Terapkan'))]));
      if (confirmed != true) return;
      await widget.guard.run('Stock opname', () => widget.api.adjust(idNumber(widget.product['id'] ?? widget.product['productId']), after, reason.text.trim().isEmpty ? null : reason.text.trim()));
      if (mounted) Navigator.pop(context, true);
    } catch (e) { if (mounted) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override Widget build(BuildContext context) => PopScope(canPop: !saving, child: SafeArea(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.viewInsetsOf(context).bottom + 24), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text((widget.product['namaItem'] ?? 'Hasil hitung fisik').toString(), style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: Space.lg),
    SummaryRow('Stok sistem', '${quantityText(widget.product['stok'])} ${widget.product['satuan'] ?? ''}'),
    const SizedBox(height: 12), TextField(controller: actual, enabled: !saving, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Total stok fisik', helperText: 'Isi hasil hitung akhir, bukan jumlah selisih.')),
    const SizedBox(height: Space.lg), TextField(controller: reason, enabled: !saving, maxLength: 255, decoration: const InputDecoration(labelText: 'Alasan (opsional)')),
    if (error != null) Text(error!, style: const TextStyle(color: wine)), const SizedBox(height: Space.lg),
    SizedBox(width: double.infinity, child: FilledButton(onPressed: saving ? null : save, child: Text(saving ? 'Menyimpan…' : 'Simpan ke PC'))),
  ]))));
}
