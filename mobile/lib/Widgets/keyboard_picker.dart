import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/theme.dart';

/// A row a [showKeyboardPicker] can offer.
class PickerOption<T> {
  const PickerOption(this.value, {required this.title, this.subtitle, this.trailing, this.enabled = true});
  final T value;
  final String title;
  final String? subtitle, trailing;

  /// Shown but not pickable (a product with no stock).
  final bool enabled;
}

/// The desktop's command dialogs, for the keyboard: type to search, Up/Down or
/// PageUp/PageDown to move, Enter to pick, Esc to close. [load] answers each query;
/// [extra] can offer an option built from the typed text itself (a new customer).
Future<T?> showKeyboardPicker<T>(BuildContext context, {
  required String title,
  required String hint,
  String? description,
  required Future<List<PickerOption<T>>> Function(String query) load,
  PickerOption<T>? Function(String query, List<PickerOption<T>> results)? extra,
  String emptyText = 'Tidak ada yang cocok.',
}) => showDialog<T>(context: context, builder: (_) => _KeyboardPicker<T>(
  title: title, hint: hint, description: description, load: load, extra: extra, emptyText: emptyText));

class _KeyboardPicker<T> extends StatefulWidget {
  const _KeyboardPicker({required this.title, required this.hint, required this.description, required this.load, required this.extra, required this.emptyText});
  final String title, hint, emptyText;
  final String? description;
  final Future<List<PickerOption<T>>> Function(String query) load;
  final PickerOption<T>? Function(String query, List<PickerOption<T>> results)? extra;
  @override State<_KeyboardPicker<T>> createState() => _KeyboardPickerState<T>();
}

class _KeyboardPickerState<T> extends State<_KeyboardPicker<T>> {
  final query = TextEditingController();
  final scroll = ScrollController();
  List<PickerOption<T>> options = [];
  int selected = 0, serial = 0;
  bool loading = true;
  String? error;
  Timer? timer;

  @override void initState() { super.initState(); search(); }
  @override void dispose() { timer?.cancel(); query.dispose(); scroll.dispose(); super.dispose(); }

  Future<void> search() async {
    final request = ++serial;
    setState(() { loading = true; error = null; });
    try {
      final results = await widget.load(query.text.trim());
      if (!mounted || request != serial) return;
      final made = widget.extra?.call(query.text.trim(), results);
      setState(() {
        options = [if (made != null) made, ...results];
        selected = options.indexWhere((o) => o.enabled).clamp(0, options.isEmpty ? 0 : options.length - 1);
      });
    } catch (e) { if (mounted && request == serial) setState(() => error = e.toString()); }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }

  void move(int delta) {
    if (options.isEmpty) return;
    var next = selected;
    for (var i = 0; i < options.length; i++) {
      next = (next + delta) % options.length;
      if (next < 0) next += options.length;
      if (options[next].enabled) break;
    }
    setState(() => selected = next);
    // keep the highlighted row in view: rows are 52px tall
    final target = selected * 52.0;
    if (scroll.hasClients) {
      final view = scroll.position.viewportDimension;
      if (target < scroll.offset) scroll.jumpTo(target);
      if (target + 52 > scroll.offset + view) scroll.jumpTo(target + 52 - view);
    }
  }

  void pick([int? index]) {
    final i = index ?? selected;
    if (i < 0 || i >= options.length || !options[i].enabled) return;
    Navigator.of(context).pop(options[i].value);
  }

  @override
  Widget build(BuildContext context) => Dialog(
    alignment: const Alignment(0, -0.5),
    child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 560, maxHeight: 520), child: Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.arrowDown): _Move(1), SingleActivator(LogicalKeyboardKey.pageDown): _Move(1),
        SingleActivator(LogicalKeyboardKey.arrowUp): _Move(-1), SingleActivator(LogicalKeyboardKey.pageUp): _Move(-1),
      },
      child: Actions(actions: {_Move: CallbackAction<_Move>(onInvoke: (m) { move(m.delta); return null; })}, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.lg, Space.sm), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
          if (widget.description != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(widget.description!, style: TextStyle(color: muted, fontSize: 13))),
          const SizedBox(height: Space.md),
          TextField(controller: query, autofocus: true, textInputAction: TextInputAction.go,
            onChanged: (_) { timer?.cancel(); timer = Timer(const Duration(milliseconds: 250), search); },
            onSubmitted: (_) async { timer?.cancel(); if (loading) await search(); pick(); },
            decoration: InputDecoration(hintText: widget.hint, prefixIcon: const Icon(Icons.search, size: 20))),
        ])),
        if (loading) const LinearProgressIndicator(minHeight: 2) else const Divider(),
        Flexible(child: error != null
          ? Padding(padding: const EdgeInsets.all(Space.lg), child: Text(error!, style: TextStyle(color: errorColor)))
          : options.isEmpty
            ? Padding(padding: const EdgeInsets.all(Space.lg), child: Text(loading ? 'Mencari…' : widget.emptyText, style: TextStyle(color: muted)))
            : ListView.builder(controller: scroll, shrinkWrap: true, itemCount: options.length, itemExtent: 52, itemBuilder: (context, i) {
                final o = options[i];
                final on = i == selected;
                return Material(color: on ? activePill : Colors.transparent, child: InkWell(onTap: o.enabled ? () => pick(i) : null,
                  child: Padding(padding: const EdgeInsets.symmetric(horizontal: Space.lg), child: Row(children: [
                    Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(o.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: o.enabled ? ink : muted)),
                      if (o.subtitle != null) Text(o.subtitle!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 12)),
                    ])),
                    if (o.trailing != null) Text(o.trailing!, style: amountStyle.copyWith(fontSize: 13, color: o.enabled ? ink : errorColor)),
                  ]))));
              })),
        const Divider(),
        Padding(padding: EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.sm),
          child: Text('↑↓ atau PageUp/PageDown pilih · Enter ambil · Esc tutup', style: TextStyle(color: muted, fontSize: 12))),
      ]))),
    ),
  );
}

class _Move extends Intent {
  const _Move(this.delta);
  final int delta;
}
