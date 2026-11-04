import 'package:flutter/material.dart';
import '../../services/business_api.dart';
import '../../services/mutation_guard.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
class LiveSupplierScreen extends StatefulWidget {
  const LiveSupplierScreen({super.key, required this.api, required this.guard});
  final BusinessApi api;
  final MutationGuard guard;
  @override State<LiveSupplierScreen> createState() => _LiveSupplierScreenState();
}
class _LiveSupplierScreenState extends State<LiveSupplierScreen> {
  final query = TextEditingController();
  List<Map<String, dynamic>> rows = [];
  String? error;
  bool loading = true;
  int page = 1, last = 1, serial = 0;
  @override void initState() { super.initState(); load(); }
  @override void dispose() { query.dispose(); super.dispose(); }
  Future<void> load({int target = 1}) async {
    final n = ++serial; setState(() { loading = true; error = null; });
    try { final result = await widget.api.suppliers(query.text.trim(), target); final parsed = jsonRows(result);
      if (mounted && n == serial) setState(() { rows = parsed; page = target; last = result is Map ? (number(result['lastPage']) ?? target).toInt() : target; });
    } catch (e) { if (mounted && n == serial) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted && n == serial) setState(() => loading = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Pilih supplier')), body: SafeArea(child: ListView(padding: const EdgeInsets.all(Space.lg), children: [
    TextField(controller: query, onSubmitted: (_) => load(), decoration: InputDecoration(hintText: 'Cari supplier', prefixIcon: const Icon(Icons.search), suffixIcon: IconButton(tooltip: 'Cari supplier', onPressed: () => load(), icon: const Icon(Icons.arrow_forward)))),
    const SizedBox(height: 12), OutlinedButton.icon(onPressed: () async { await showDialog<void>(context: context, builder: (_) => _CreateSupplier(api: widget.api, guard: widget.guard)); if (mounted) load(); }, icon: const Icon(Icons.add), label: const Text('Supplier baru')),
    const SizedBox(height: Space.lg), if (loading) const Center(child: CircularProgressIndicator())
    else if (error != null) EmptyPanel(icon: Icons.error_outline, title: 'Supplier belum dimuat', message: error!, action: TextButton(onPressed: () => load(), child: const Text('Coba lagi')))
    else if (rows.isEmpty) const EmptyPanel(icon: Icons.local_shipping_outlined, title: 'Supplier tidak ditemukan', message: 'Coba kata lain atau tambahkan supplier baru.')
    else for (final row in rows) RecordRow(title: (row['nama'] ?? row['name'] ?? 'Supplier').toString(), subtitle: (row['telepon'] ?? row['alamat'] ?? '').toString(), actionLabel: 'Pilih supplier', onTap: () {
      try { idNumber(row['id'] ?? row['supplierId']); Navigator.pop(context, row); } catch (e) { showError(context, e); }
    }),
    Row(mainAxisAlignment: MainAxisAlignment.center, children: [IconButton(tooltip: 'Halaman sebelumnya', onPressed: !loading && page > 1 ? () => load(target: page - 1) : null, icon: const Icon(Icons.chevron_left)), Text('$page / $last'), IconButton(tooltip: 'Halaman berikutnya', onPressed: !loading && page < last ? () => load(target: page + 1) : null, icon: const Icon(Icons.chevron_right))]),
  ])));
}
class _CreateSupplier extends StatefulWidget {
  const _CreateSupplier({required this.api, required this.guard});
  final BusinessApi api;
  final MutationGuard guard;
  @override State<_CreateSupplier> createState() => _CreateSupplierState();
}
class _CreateSupplierState extends State<_CreateSupplier> {
  final name = TextEditingController(), phone = TextEditingController(), address = TextEditingController(), note = TextEditingController();
  bool saving = false;
  String? error;
  @override void dispose() { for (final c in [name, phone, address, note]) { c.dispose(); } super.dispose(); }
  Future<void> save() async {
    if (saving) return; setState(() { saving = true; error = null; });
    try {
      if (name.text.trim().isEmpty) throw const FormatException('Nama supplier wajib diisi.');
      String? optional(String value) => value.trim().isEmpty ? null : value.trim();
      await widget.guard.run('Supplier baru', () => widget.api.createSupplier({'nama': name.text.trim(), 'telepon': optional(phone.text), 'alamat': optional(address.text), 'keterangan': optional(note.text)}));
      if (mounted) Navigator.pop(context);
    } catch (e) { if (mounted) { setState(() { saving = false; error = e.toString(); }); showError(context, e); } }
  }
  @override Widget build(BuildContext context) => PopScope(canPop: !saving, child: AlertDialog(title: const Text('Supplier baru'), content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
    TextField(controller: name, enabled: !saving, decoration: const InputDecoration(labelText: 'Nama supplier')), const SizedBox(height: 12),
    TextField(controller: phone, enabled: !saving, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Telepon (opsional)')), const SizedBox(height: 12),
    TextField(controller: address, enabled: !saving, decoration: const InputDecoration(labelText: 'Alamat (opsional)')), const SizedBox(height: 12),
    TextField(controller: note, enabled: !saving, decoration: const InputDecoration(labelText: 'Keterangan (opsional)')),
    if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: errorColor))),
  ])), actions: [TextButton(onPressed: saving ? null : () => Navigator.pop(context), child: const Text('Batal')), FilledButton(onPressed: saving ? null : save, child: Text(saving ? 'Menyimpan…' : 'Simpan'))]));
}
