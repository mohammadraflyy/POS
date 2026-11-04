import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../models/pos_models.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
class OpnameSheet extends StatefulWidget {
  const OpnameSheet({super.key, required this.app, required this.product});
  final AppState app;
  final Product product;
  @override
  State<OpnameSheet> createState() => _OpnameSheetState();
}
class _OpnameSheetState extends State<OpnameSheet> {
  final _actual = TextEditingController();
  final _reason = TextEditingController();
  String? _error;
  bool _saving = false;
  @override
  void dispose() { _actual.dispose(); _reason.dispose(); super.dispose(); }
  Future<void> _save() async {
    if (_saving) return;
    setState(() { _saving = true; _error = null; });
    try {
      final after = qtyInput(_actual.text, allowZero: true);
      if (_reason.text.length > 255) throw const FormatException('Alasan maksimal 255 karakter.');
      final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Terapkan hasil hitung?'),
        content: Text('Stok demo ${widget.product.name} diubah dari ${qty(widget.product.stock)} menjadi ${qty(after)} ${widget.product.baseUnit.name}. Harga pokok tetap.'),
        actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Periksa lagi')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Terapkan'))]));
      if (!mounted) return;
      if (confirmed != true) { setState(() => _saving = false); return; }
      widget.app.demo.adjust(widget.product, after, _reason.text);
      widget.app.refreshDemo(); Navigator.pop(context);
    } catch (e) { if (mounted) { setState(() { _error = errorText(e); _saving = false; }); showError(context, e); } }
  }
  @override
  Widget build(BuildContext context) {
    int? delta;
    try { delta = qtyInput(_actual.text, allowZero: true) - widget.product.stock; } catch (_) {}
    return SafeArea(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.viewInsetsOf(context).bottom + 24), child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      const Pill('STOCK OPNAME DEMO'), const SizedBox(height: Space.lg), Text(widget.product.name, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 12), SummaryRow('Stok sistem', '${qty(widget.product.stock)} ${widget.product.baseUnit.name}'),
      const SizedBox(height: Space.lg), TextField(controller: _actual, enabled: !_saving, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Hasil hitung fisik (${widget.product.baseUnit.name})', helperText: 'Isi total stok yang benar, bukan jumlah selisih.')),
      const SizedBox(height: Space.lg), TextField(controller: _reason, enabled: !_saving, maxLength: 255, decoration: const InputDecoration(labelText: 'Alasan (opsional)')),
      const SizedBox(height: 10), SummaryRow('Selisih', delta == null ? '—' : '${delta > 0 ? '+' : ''}${qty(delta)} ${widget.product.baseUnit.name}', strong: true),
      if (_error != null) Text(_error!, style: const TextStyle(color: errorColor)),
      const SizedBox(height: Space.lg), SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _save, child: const Text('Simpan hasil hitung demo'))),
    ])));
  }
}
