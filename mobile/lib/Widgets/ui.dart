import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/format.dart';
import 'notifications.dart';
export 'notifications.dart';
void showError(BuildContext context, Object error) {
  showNotice(context, errorText(error), kind: NoticeKind.error);
}
class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.color = wine, this.icon});
  final String label;
  final Color color;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(color: color.withAlpha(14), borderRadius: BorderRadius.circular(6)),
    child: Wrap(spacing: Space.xs, crossAxisAlignment: WrapCrossAlignment.center, children: [
      if (icon != null) ...[Icon(icon, size: 13, color: color), const SizedBox(width: 5)],
      Text(label, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w600)),
    ]),
  );
}
class EmptyPanel extends StatelessWidget {
  const EmptyPanel({super.key, required this.icon, required this.title, required this.message, this.action});
  final IconData icon;
  final String title, message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Center(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: Column(
    mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 28, color: muted),
      const SizedBox(height: Space.lg), Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8), ConstrainedBox(constraints: const BoxConstraints(maxWidth: 390), child: Text(message, textAlign: TextAlign.center, style: const TextStyle(color: muted))),
      if (action != null) ...[const SizedBox(height: 20), action!],
    ],
  )));
}
class SummaryRow extends StatelessWidget {
  const SummaryRow(this.label, this.value, {super.key, this.strong = false, this.color});
  final String label, value;
  final bool strong;
  final Color? color;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [
    Expanded(child: Text(label, style: TextStyle(color: strong ? ink : muted, fontSize: strong ? 18 : 14, fontWeight: strong ? FontWeight.w700 : FontWeight.normal))),
    const SizedBox(width: 12), Flexible(child: Text(value, textAlign: TextAlign.end, style: amountStyle.copyWith(color: color ?? ink, fontSize: strong ? 24 : 14))),
  ]));
}
class WhitePanel extends StatelessWidget {
  const WhitePanel({super.key, required this.child, this.padding = const EdgeInsets.all(Space.lg)});
  final Widget child;
  final EdgeInsetsGeometry padding;
  @override
  // a Material rather than a decorated box, so list tiles inside can paint their ink
  Widget build(BuildContext context) => Material(color: surface, clipBehavior: Clip.antiAlias,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.panel), side: const BorderSide(color: lineColor)),
    child: Padding(padding: padding, child: child));
}

class PageIntro extends StatelessWidget {
  const PageIntro(this.title, this.description, {super.key});
  final String title, description;
  @override Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Space.xl),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: Space.xs),
      Text(description, style: Theme.of(context).textTheme.bodySmall),
    ]),
  );
}

/// A bounded reading/form width that still fills the available scroll height.
class WorkArea extends StatelessWidget {
  const WorkArea({super.key, required this.child, this.maxWidth = 760});
  final Widget child;
  final double maxWidth;
  @override Widget build(BuildContext context) => Align(alignment: Alignment.topCenter,
    child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: child));
}

class CartAction extends StatelessWidget {
  const CartAction({super.key, required this.count, required this.total, required this.onPressed});
  final int count;
  final String total;
  final VoidCallback onPressed;
  @override Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(Space.md),
    decoration: const BoxDecoration(color: surface, border: Border(top: BorderSide(color: lineColor))),
    child: SizedBox(width: double.infinity, child: FilledButton(onPressed: onPressed,
      child: Wrap(alignment: WrapAlignment.spaceBetween, spacing: Space.lg, runSpacing: Space.xs, children: [
        Text('Keranjang ($count)'), Text(total, style: amountStyle.copyWith(color: Colors.white)),
      ]))),
  );
}

class CartLayout extends StatelessWidget {
  const CartLayout({super.key, required this.header, required this.items, required this.footer});
  final Widget header, footer;
  final List<Widget> items;
  @override Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
    final compact = box.maxHeight < 560 || MediaQuery.textScalerOf(context).scale(14) > 20;
    final contents = items.isEmpty ? <Widget>[const EmptyPanel(icon: Icons.shopping_basket_outlined,
      title: 'Keranjang kosong', message: 'Tambahkan barang dari katalog.')] : items;
    return Material(color: surface, child: compact
      ? ListView(padding: const EdgeInsets.all(Space.lg), children: [header, const Divider(), ...contents, const Divider(), footer])
      : Column(children: [Padding(padding: const EdgeInsets.all(Space.lg), child: header), const Divider(),
          Expanded(child: ListView(padding: const EdgeInsets.symmetric(horizontal: Space.lg), children: contents)),
          const Divider(), Padding(padding: const EdgeInsets.all(Space.lg), child: footer),
        ]));
  });
}

class RecordRow extends StatelessWidget {
  const RecordRow({super.key, required this.title, required this.subtitle,
    this.value, this.onTap, this.actionLabel = 'Lihat detail'});
  final String title, subtitle, actionLabel;
  final String? value;
  final VoidCallback? onTap;
  @override Widget build(BuildContext context) => Material(color: surface,
    child: InkWell(onTap: onTap, child: Container(
      padding: const EdgeInsets.all(Space.lg),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: lineColor))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: Space.xs), Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
        if (value != null || onTap != null) ...[
          const SizedBox(height: Space.sm),
          Wrap(spacing: Space.lg, runSpacing: Space.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (value != null) Text(value!, style: amountStyle.copyWith(fontSize: 16)),
            if (onTap != null) Text(actionLabel, style: const TextStyle(color: wine, fontSize: 14, fontWeight: FontWeight.w500)),
          ]),
        ],
      ]),
    )),
  );
}

class PaymentTotal extends StatelessWidget {
  const PaymentTotal({super.key, required this.total, required this.description});
  final String total, description;
  @override Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    const Text('Total pembayaran', style: TextStyle(color: muted)),
    const SizedBox(height: Space.sm),
    Text(total, style: amountStyle.copyWith(fontSize: 32, color: ink)),
    const SizedBox(height: Space.xs), Text(description, style: Theme.of(context).textTheme.bodySmall),
    const SizedBox(height: Space.xl), const Divider(), const SizedBox(height: Space.xl),
  ]);
}
