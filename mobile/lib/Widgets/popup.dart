import 'package:flutter/material.dart';
import '../core/theme.dart';
import 'admin.dart' show isDesktop;

/// The app's popup: a tinted icon beside the title, the body, and a footer of
/// equal-width buttons. [onClose] adds the × in the corner.
class AppPopup extends StatelessWidget {
  const AppPopup({super.key, required this.icon, required this.tone, required this.title, this.subtitle,
    required this.body, required this.actions, this.onClose});
  final IconData icon;
  final Color tone;
  final String title;
  final String? subtitle;
  final Widget body;
  final List<Widget> actions;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) => Dialog(
    backgroundColor: surface,
    surfaceTintColor: Colors.transparent,
    clipBehavior: Clip.antiAlias,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: BorderSide(color: ruleColor)),
    child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 460), child: Column(
      mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: EdgeInsets.fromLTRB(24, 24, onClose == null ? 24 : 12, 0), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 44, height: 44,
            decoration: BoxDecoration(color: tone.withValues(alpha: isDark ? 0.18 : 0.10), borderRadius: BorderRadius.circular(12)),
            child: Icon(icon, color: tone, size: 22)),
          const SizedBox(width: 14),
          Expanded(child: Padding(padding: const EdgeInsets.only(top: 2), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: ink, height: 1.3)),
            if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(subtitle!, style: TextStyle(fontSize: 13, color: muted))),
          ]))),
          if (onClose != null) IconButton(onPressed: onClose, tooltip: 'Tutup', visualDensity: VisualDensity.compact,
            icon: Icon(Icons.close_rounded, size: 18, color: muted)),
        ])),
        Flexible(child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(24, 14, 24, 22),
          child: DefaultTextStyle.merge(style: TextStyle(color: muted, fontSize: 14, height: 1.5), child: body))),
        Container(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 16),
          decoration: BoxDecoration(color: raised, border: Border(top: BorderSide(color: ruleColor))),
          child: Row(children: [
            for (var i = 0; i < actions.length; i++) ...[if (i > 0) const SizedBox(width: 10), Expanded(child: actions[i])],
          ]),
        ),
      ])),
  );
}

/// A footer button. [primary] fills it (in [tone] when given); [keyHint] shows the
/// keyboard shortcut beside the label on desktop, e.g. "Enter" or "Esc".
class PopupButton extends StatelessWidget {
  const PopupButton(this.label, {super.key, required this.onPressed, this.primary = false, this.tone,
    this.keyHint, this.autofocus = false, this.busy = false});
  final String label;
  final VoidCallback? onPressed;
  final bool primary, autofocus, busy;
  final Color? tone;
  final String? keyHint;

  @override
  Widget build(BuildContext context) {
    final style = ButtonStyle(
      minimumSize: const WidgetStatePropertyAll(Size(0, 44)),
      shape: WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
      backgroundColor: primary && tone != null ? WidgetStatePropertyAll(tone) : null,
    );
    final hint = keyHint;
    final child = Row(mainAxisSize: MainAxisSize.min, children: [
      if (busy) SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: primary ? onPrimary : ink))
      else Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
      if (isDesktop && hint != null && !busy) ...[const SizedBox(width: 8), _KeyCap(hint, onFill: primary)],
    ]);
    return primary
      ? FilledButton(onPressed: onPressed, autofocus: autofocus, style: style, child: child)
      : OutlinedButton(onPressed: onPressed, autofocus: autofocus, style: style, child: child);
  }
}

class _KeyCap extends StatelessWidget {
  const _KeyCap(this.label, {required this.onFill});
  final String label;
  final bool onFill;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
    decoration: BoxDecoration(borderRadius: BorderRadius.circular(4),
      border: Border.all(color: onFill ? onPrimary.withValues(alpha: 0.45) : lineColor)),
    child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500,
      color: onFill ? onPrimary.withValues(alpha: 0.8) : muted)),
  );
}
