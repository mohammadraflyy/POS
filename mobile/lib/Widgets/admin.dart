import 'dart:async';
import 'dart:io';
import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/live_models.dart';
import '../services/mobile_api.dart';
import 'ui.dart';

/// PC-only conveniences (save dialogs, keyboard shortcuts) switch on here. Read from the
/// target platform rather than the host, so widget tests run as a phone on any machine.
bool get isDesktop => switch (defaultTargetPlatform) { TargetPlatform.windows || TargetPlatform.linux || TargetPlatform.macOS => true, _ => false };

Future<bool> confirmAction(BuildContext context, {required String title, required String message,
    String confirmLabel = 'Ya, lanjutkan', bool destructive = false}) async {
  final yes = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
    title: Text(title), content: Text(message),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
      FilledButton(onPressed: () => Navigator.pop(context, true),
        style: destructive ? FilledButton.styleFrom(backgroundColor: errorColor) : null, child: Text(confirmLabel)),
    ]));
  return yes == true;
}

/// Runs a write and reports it: the server's own message on failure, [success] on success.
Future<bool> runAction(BuildContext context, Future<Object?> Function() action, {String? success}) async {
  try {
    await action();
    if (success != null && context.mounted) showNotice(context, success, kind: NoticeKind.success);
    return true;
  } catch (e) {
    if (context.mounted) showError(context, e);
    return false;
  }
}

/// Saves a downloaded file where the user picks (PC). Returns the path, or null if cancelled.
Future<String?> saveDownload(BuildContext context, FileResponse response, String suggestedName) async {
  try {
    if (isDesktop) {
      final location = await getSaveLocation(suggestedName: suggestedName,
        acceptedTypeGroups: const [XTypeGroup(label: 'Excel', extensions: ['xlsx'])]);
      if (location == null) return null;
      await File(location.path).writeAsBytes(response.bytes);
      if (context.mounted) showNotice(context, 'File disimpan di ${location.path}', kind: NoticeKind.success);
      return location.path;
    }
    throw const ApiFailure('Ekspor Excel tersedia di aplikasi PC.');
  } catch (e) {
    if (context.mounted) showError(context, e);
    return null;
  }
}

/// Lets the user pick a spreadsheet to upload. Returns (name, bytes) or null.
Future<(String, List<int>)?> pickSpreadsheet() async {
  final file = await openFile(acceptedTypeGroups: const [XTypeGroup(label: 'Spreadsheet', extensions: ['xlsx', 'csv'])]);
  if (file == null) return null;
  return (file.name, await file.readAsBytes());
}

Future<DateTimeRange?> pickRange(BuildContext context, DateTimeRange? current) => showDateRangePicker(
  context: context, firstDate: DateTime(2020), lastDate: DateTime(DateTime.now().year + 1, 12, 31), initialDateRange: current);

DateTimeRange thisMonth() {
  final now = DateTime.now();
  return DateTimeRange(start: DateTime(now.year, now.month), end: DateTime(now.year, now.month + 1, 0));
}

String rangeLabel(DateTimeRange range) => '${dateText(range.start)} – ${dateText(range.end)}';

String dateTimeLabel(Object? iso) {
  final parsed = DateTime.tryParse(iso?.toString() ?? '');
  return parsed == null ? (iso?.toString() ?? '—') : '${dateText(parsed.toLocal())} ${timeText(parsed.toLocal())}';
}

const metodeLabel = {'tunai': 'Tunai', 'bon': 'Bon', 'qris': 'QRIS', 'transfer': 'Transfer'};

// ---------------------------------------------------------------------------
// Data table: a real table on a PC, stacked cards on a phone
// ---------------------------------------------------------------------------

class DataCol<T> {
  const DataCol(this.label, this.cell, {this.numeric = false, this.flex = 1});
  final String label;
  final String Function(T row) cell;
  final bool numeric;
  final int flex;
}

class DataView<T> extends StatelessWidget {
  const DataView({super.key, required this.rows, required this.columns, this.onTap, this.actions,
    this.emptyTitle = 'Belum ada data', this.emptyMessage = 'Data akan tampil di sini.', this.isSelected, this.onSelect, this.actionsWidth = 120});
  final List<T> rows;
  final List<DataCol<T>> columns;
  final void Function(T row)? onTap;
  final List<Widget> Function(T row)? actions;
  final String emptyTitle, emptyMessage;

  /// Room for [actions] on wide screens; widen it for text buttons.
  final double actionsWidth;

  /// Both set: each row gets a checkbox, for actions on several rows at once.
  final bool Function(T row)? isSelected;
  final void Function(T row, bool selected)? onSelect;
  bool get _selectable => isSelected != null && onSelect != null;
  Widget _checkbox(T row) => SizedBox(width: 40, child: Checkbox(value: isSelected!(row), onChanged: (v) => onSelect!(row, v ?? false)));
  @override Widget build(BuildContext context) {
    if (rows.isEmpty) return EmptyPanel(icon: Icons.inbox_outlined, title: emptyTitle, message: emptyMessage);
    return LayoutBuilder(builder: (context, box) {
      final wide = box.maxWidth >= 720;
      if (!wide) {
        return Column(children: [for (final row in rows) Material(color: surface, child: InkWell(
          onTap: onTap == null ? null : () => onTap!(row),
          child: Container(width: double.infinity, padding: const EdgeInsets.all(Space.lg),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: lineColor))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                if (_selectable) _checkbox(row),
                Expanded(child: Text(columns.first.cell(row), style: Theme.of(context).textTheme.titleMedium)),
              ]),
              const SizedBox(height: Space.xs),
              Wrap(spacing: Space.lg, runSpacing: Space.xs, children: [
                for (final col in columns.skip(1)) Text('${col.label}: ${col.cell(row)}', style: Theme.of(context).textTheme.bodySmall),
              ]),
              if (actions != null) Wrap(spacing: Space.xs, children: actions!(row)),
            ]))))]);
      }
      return Container(decoration: BoxDecoration(color: surface, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel)),
        clipBehavior: Clip.antiAlias, child: Column(children: [
          Container(color: canvas, padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md), child: Row(children: [
            if (_selectable) const SizedBox(width: 40),
            for (final col in columns) Expanded(flex: col.flex, child: Text(col.label, textAlign: col.numeric ? TextAlign.end : TextAlign.start,
              style: const TextStyle(fontWeight: FontWeight.w600, color: muted, fontSize: 13))),
            if (actions != null) SizedBox(width: actionsWidth),
          ])),
          for (final row in rows) InkWell(onTap: onTap == null ? null : () => onTap!(row), child: Container(
            padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: lineColor))),
            child: Row(children: [
              if (_selectable) _checkbox(row),
              for (final col in columns) Expanded(flex: col.flex, child: Text(col.cell(row), textAlign: col.numeric ? TextAlign.end : TextAlign.start,
                style: col.numeric ? amountStyle.copyWith(fontWeight: FontWeight.w500) : null)),
              if (actions != null) SizedBox(width: actionsWidth, child: Row(mainAxisAlignment: MainAxisAlignment.end, children: actions!(row))),
            ]))),
        ]));
    });
  }
}

class Pager extends StatelessWidget {
  const Pager({super.key, required this.page, required this.last, required this.onPage, this.busy = false});
  final int page, last;
  final bool busy;
  final ValueChanged<int> onPage;
  @override Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: Space.md), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
    IconButton(tooltip: 'Halaman sebelumnya', onPressed: !busy && page > 1 ? () => onPage(page - 1) : null, icon: const Icon(Icons.chevron_left)),
    Text('$page / $last'),
    IconButton(tooltip: 'Halaman berikutnya', onPressed: !busy && page < last ? () => onPage(page + 1) : null, icon: const Icon(Icons.chevron_right)),
  ]));
}

class StatTile extends StatelessWidget {
  const StatTile(this.label, this.value, {super.key, this.color, this.icon});
  final String label, value;
  final Color? color;
  final IconData? icon;
  // two to a row on a phone (page padding and the gap between tiles taken off), fixed on a PC
  @override Widget build(BuildContext context) => SizedBox(width: MediaQuery.sizeOf(context).width < 600 ? (MediaQuery.sizeOf(context).width - Space.lg * 2 - Space.md) / 2 : 230,
    child: WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Row(children: [if (icon != null) ...[Icon(icon, size: 18, color: muted), const SizedBox(width: 6)], Expanded(child: Text(label, style: const TextStyle(color: muted, fontSize: 13)))]),
    const SizedBox(height: Space.sm),
    Text(value, style: amountStyle.copyWith(fontSize: 22, color: color ?? ink)),
  ])));
}

/// A search box that waits for the user to stop typing.
class SearchBox extends StatefulWidget {
  const SearchBox({super.key, required this.onChanged, this.hint = 'Cari', this.autofocus = false, this.focusNode});
  final ValueChanged<String> onChanged;
  final String hint;
  final bool autofocus;
  final FocusNode? focusNode;
  @override State<SearchBox> createState() => _SearchBoxState();
}
class _SearchBoxState extends State<SearchBox> {
  Timer? _timer;
  @override void dispose() { _timer?.cancel(); super.dispose(); }
  @override Widget build(BuildContext context) => TextField(autofocus: widget.autofocus, focusNode: widget.focusNode,
    onChanged: (value) { _timer?.cancel(); _timer = Timer(const Duration(milliseconds: 350), () => widget.onChanged(value.trim())); },
    onSubmitted: (value) { _timer?.cancel(); widget.onChanged(value.trim()); },
    decoration: InputDecoration(labelText: widget.hint, prefixIcon: const Icon(Icons.search)));
}

/// Shows the standard loading / error / content states of a screen that loads once.
class LoadSwitch extends StatelessWidget {
  const LoadSwitch({super.key, required this.loading, required this.error, required this.onRetry, required this.child});
  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  final Widget child;
  @override Widget build(BuildContext context) {
    if (loading) return const Padding(padding: EdgeInsets.all(Space.xl), child: Center(child: CircularProgressIndicator()));
    if (error != null) return EmptyPanel(icon: Icons.wifi_off, title: 'Data belum dimuat', message: error!, action: OutlinedButton(onPressed: onRetry, child: const Text('Coba lagi')));
    return child;
  }
}

// ---------------------------------------------------------------------------
// Form dialog built from field specs
// ---------------------------------------------------------------------------

enum FieldKind { text, multiline, money, number, integer, date, choice, password, toggle }

class FieldSpec {
  const FieldSpec(this.key, this.label, {this.kind = FieldKind.text, this.required = false, this.initial, this.choices, this.helper});
  final String key, label;
  final FieldKind kind;
  final bool required;
  final Object? initial;

  /// value -> label, for [FieldKind.choice]
  final Map<Object?, String>? choices;
  final String? helper;
}

/// Opens a form and returns the typed values (money and numbers as num, dates as
/// YYYY-MM-DD, empty optional text as null), or null if cancelled.
Future<Map<String, dynamic>?> showFormDialog(BuildContext context, {required String title, required List<FieldSpec> fields,
    String saveLabel = 'Simpan', Future<Object?> Function(Map<String, dynamic> values)? onSave}) =>
  showDialog<Map<String, dynamic>>(context: context, builder: (_) => _FormDialog(title: title, fields: fields, saveLabel: saveLabel, onSave: onSave));

class _FormDialog extends StatefulWidget {
  const _FormDialog({required this.title, required this.fields, required this.saveLabel, this.onSave});
  final String title, saveLabel;
  final List<FieldSpec> fields;
  final Future<Object?> Function(Map<String, dynamic> values)? onSave;
  @override State<_FormDialog> createState() => _FormDialogState();
}
class _FormDialogState extends State<_FormDialog> {
  late final controllers = {
    for (final f in widget.fields) if (f.kind != FieldKind.choice && f.kind != FieldKind.toggle) f.key: TextEditingController(text: _initialText(f)),
  };
  late final choices = {for (final f in widget.fields) if (f.kind == FieldKind.choice || f.kind == FieldKind.toggle) f.key: f.initial};
  String? error;
  bool saving = false;
  String _initialText(FieldSpec f) {
    final v = f.initial;
    if (v == null) return f.kind == FieldKind.date ? isoDate(DateTime.now()) : '';
    if (v is num && (f.kind == FieldKind.money || f.kind == FieldKind.number)) return v == v.roundToDouble() ? v.toInt().toString() : v.toString();
    return v.toString();
  }
  @override void dispose() { for (final c in controllers.values) { c.dispose(); } super.dispose(); }
  Map<String, dynamic> _collect() {
    final values = <String, dynamic>{};
    for (final f in widget.fields) {
      if (f.kind == FieldKind.choice || f.kind == FieldKind.toggle) {
        if (f.required && choices[f.key] == null) throw FormatException('${f.label} wajib dipilih.');
        values[f.key] = choices[f.key] ?? (f.kind == FieldKind.toggle ? false : null);
        continue;
      }
      final text = controllers[f.key]!.text.trim();
      if (text.isEmpty) {
        if (f.required) throw FormatException('${f.label} wajib diisi.');
        values[f.key] = null;
        continue;
      }
      values[f.key] = switch (f.kind) {
        FieldKind.money => inputRupiah(text),
        FieldKind.number => inputQty(text, zero: true),
        FieldKind.integer => int.tryParse(text) ?? (throw FormatException('${f.label} harus bilangan bulat.')),
        FieldKind.date => DateTime.tryParse(text) == null ? (throw FormatException('${f.label} harus berformat YYYY-MM-DD.')) : text,
        FieldKind.password => controllers[f.key]!.text,
        _ => text,
      };
    }
    return values;
  }
  Future<void> _save() async {
    if (saving) return;
    setState(() { error = null; saving = true; });
    try {
      final values = _collect();
      if (widget.onSave != null) await widget.onSave!(values);
      if (mounted) Navigator.pop(context, values);
    } catch (e) { if (mounted) setState(() => error = errorText(e)); }
    finally { if (mounted) setState(() => saving = false); }
  }
  Widget _field(FieldSpec f) {
    switch (f.kind) {
      case FieldKind.choice:
        return DropdownButtonFormField<Object?>(initialValue: choices[f.key], isExpanded: true,
          decoration: InputDecoration(labelText: f.label + (f.required ? ' *' : ''), helperText: f.helper),
          items: [for (final e in f.choices!.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
          onChanged: saving ? null : (v) => setState(() => choices[f.key] = v));
      case FieldKind.toggle:
        return SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(f.label), subtitle: f.helper == null ? null : Text(f.helper!),
          value: choices[f.key] == true, onChanged: saving ? null : (v) => setState(() => choices[f.key] = v));
      default:
        return TextField(controller: controllers[f.key], enabled: !saving, obscureText: f.kind == FieldKind.password,
          maxLines: f.kind == FieldKind.multiline ? 3 : 1,
          keyboardType: switch (f.kind) {
            FieldKind.money || FieldKind.number => const TextInputType.numberWithOptions(decimal: true),
            FieldKind.integer => TextInputType.number,
            FieldKind.date => TextInputType.datetime,
            _ => TextInputType.text,
          },
          decoration: InputDecoration(labelText: f.label + (f.required ? ' *' : ''),
            helperText: f.helper ?? (f.kind == FieldKind.money ? 'Rupiah, tanpa titik ribuan' : f.kind == FieldKind.date ? 'Format YYYY-MM-DD' : null),
            suffixIcon: f.kind == FieldKind.date ? IconButton(tooltip: 'Pilih tanggal', icon: const Icon(Icons.event), onPressed: saving ? null : () async {
              final picked = await showDatePicker(context: context, firstDate: DateTime(2020), lastDate: DateTime(DateTime.now().year + 1, 12, 31),
                initialDate: DateTime.tryParse(controllers[f.key]!.text) ?? DateTime.now());
              if (picked != null) controllers[f.key]!.text = isoDate(picked);
            }) : null));
    }
  }
  @override Widget build(BuildContext context) => AlertDialog(title: Text(widget.title), scrollable: true,
    content: SizedBox(width: 440, child: Column(mainAxisSize: MainAxisSize.min, children: [
      for (final f in widget.fields) Padding(padding: const EdgeInsets.only(bottom: Space.md), child: _field(f)),
      if (error != null) Text(error!, style: const TextStyle(color: errorColor)),
    ])),
    actions: [
      TextButton(onPressed: saving ? null : () => Navigator.pop(context), child: const Text('Batal')),
      FilledButton(onPressed: saving ? null : _save, child: saving
        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(widget.saveLabel)),
    ]);
}

/// Title row with optional actions, for the top of every management screen.
class ScreenHeader extends StatelessWidget {
  const ScreenHeader(this.title, this.description, {super.key, this.actions = const []});
  final String title, description;
  final List<Widget> actions;
  @override Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: Space.lg), child: Wrap(
    alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: Space.lg, runSpacing: Space.md, children: [
      ConstrainedBox(constraints: const BoxConstraints(maxWidth: 520), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: Space.xs),
        Text(description, style: Theme.of(context).textTheme.bodySmall),
      ])),
      if (actions.isNotEmpty) Wrap(spacing: Space.sm, runSpacing: Space.sm, children: actions),
    ]));
}

/// Scrollable page body with a consistent width and padding.
class ScreenBody extends StatelessWidget {
  const ScreenBody({super.key, required this.children, this.maxWidth = 1200, this.onRefresh});
  final List<Widget> children;
  final double maxWidth;
  final Future<void> Function()? onRefresh;
  @override Widget build(BuildContext context) {
    final list = ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(Space.lg), children: [
      Center(child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children))),
    ]);
    return onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}

String text(Object? value, [String fallback = '—']) => value == null || value.toString().isEmpty ? fallback : value.toString();
int intOf(Object? value) => idNumber(value);
