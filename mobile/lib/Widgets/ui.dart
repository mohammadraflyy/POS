import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/format.dart';
import 'notifications.dart';
export 'notifications.dart';

void showError(BuildContext context, Object error) {
  showNotice(context, errorText(error), kind: NoticeKind.error);
}

/// Marker widget to identify when focus is inside the application sidebar.
class SidebarArea extends StatelessWidget {
  const SidebarArea({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => child;
}

/// Marker widget to identify when focus is inside the application desktop header.
class HeaderArea extends StatelessWidget {
  const HeaderArea({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => child;
}

/// A status mark inside a row or beside a value: a pale tint with dark text of the same
/// hue and subtle matching border. [color] picks the pair (success, error, warning); anything else is neutral.
class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.color, this.icon});
  final String label;

  /// successColor, errorColor or warningColor pick that pair; null or anything else is neutral.
  final Color? color;
  final IconData? icon;
  (Color, Color) get _pair => color == successColor ? (pillPositiveBg, pillPositiveInk)
    : color == errorColor ? (pillNegativeBg, pillNegativeInk)
    : color == warningColor ? (pillWarningBg, pillWarningInk)
    : (pillNeutralBg, pillNeutralInk);
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _pair;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: fg.withValues(alpha: 0.22), width: 1),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 12, color: fg), const SizedBox(width: 4)],
        Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
          style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600))),
      ]),
    );
  }
}

/// A trend badge for increases (up/green), drops (down/red), or negative balances.
class TrendBadge extends StatelessWidget {
  const TrendBadge({
    super.key,
    required this.value,
    this.isUp,
    this.isNegative = false,
    this.prefix,
  });
  final String value;
  final bool? isUp;
  final bool isNegative;
  final String? prefix;

  @override
  Widget build(BuildContext context) {
    final up = isUp ?? !isNegative;
    final bg = up ? pillPositiveBg : pillNegativeBg;
    final fg = up ? pillPositiveInk : pillNegativeInk;
    final icon = up ? Icons.trending_up_rounded : Icons.trending_down_rounded;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: fg.withValues(alpha: 0.25), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: fg),
          const SizedBox(width: 4),
          if (prefix != null) ...[
            Text(prefix!, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w600)),
            const SizedBox(width: 2),
          ],
          Text(
            value,
            style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.bold, fontFamily: fontFamily),
          ),
        ],
      ),
    );
  }
}

/// An empty block keeps its frame: one quiet sentence where the rows would be, and the
/// next step if there is one. No illustration.
class EmptyPanel extends StatelessWidget {
  const EmptyPanel({super.key, required this.icon, required this.title, required this.message, this.action});
  final IconData icon;
  final String title, message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.lg),
    decoration: BoxDecoration(color: surface, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel)),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.only(top: 2), child: Icon(icon, size: 16, color: muted)),
      const SizedBox(width: Space.md),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 2),
        Text(message, style: TextStyle(color: muted, fontSize: 14)),
        if (action != null) ...[const SizedBox(height: Space.md), action!],
      ])),
    ]),
  );
}

/// A label and its figure on one line, the figure right-aligned in tabular digits.
class SummaryRow extends StatelessWidget {
  const SummaryRow(this.label, this.value, {super.key, this.strong = false, this.color});
  final String label, value;
  final bool strong;
  final Color? color;
  @override
  Widget build(BuildContext context) => Padding(padding: EdgeInsets.symmetric(vertical: strong ? 10 : 6), child: LayoutBuilder(builder: (context, box) => Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
    Expanded(child: Text(label, style: TextStyle(color: strong ? ink : muted, fontSize: strong ? 16 : 14, fontWeight: strong ? FontWeight.w600 : FontWeight.w400))),
    const SizedBox(width: 14),
    // the figure sits on the row's right edge and shrinks rather than wrap
    ConstrainedBox(constraints: BoxConstraints(maxWidth: box.maxWidth * 0.6), child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight,
      child: Text(value, textAlign: TextAlign.end, style: (strong ? moneyStyle : amountStyle).copyWith(color: color ?? ink, fontSize: strong ? 24 : 14)))),
  ])));
}

/// A white card on the stone ground: 1px edge, rounded corners, no shadow.
class WhitePanel extends StatelessWidget {
  const WhitePanel({super.key, required this.child, this.padding = const EdgeInsets.all(Space.lg)});
  final Widget child;
  final EdgeInsetsGeometry padding;
  @override
  // a Material rather than a decorated box, so list tiles inside can paint their ink
  Widget build(BuildContext context) => Material(color: surface, clipBehavior: Clip.antiAlias,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.panel), side: BorderSide(color: lineColor)),
    child: Padding(padding: padding, child: child));
}

/// One figure in a [KpiStrip].
class Kpi {
  const Kpi(this.label, this.value, {this.caption, this.color, this.lead = false});
  final String label, value;

  /// One grey line under the figure: its window, or the next step for a zero.
  final String? caption;
  final Color? color;

  /// The figure that answers the screen's question: larger and bold.
  final bool lead;
}

/// Headline figures as type in one container split by 1px dividers - no tile per figure,
/// no icon. Four across on a PC; on a phone a two-column grid, the last cell taking the
/// full width when the count is odd.
class KpiStrip extends StatelessWidget {
  const KpiStrip(this.items, {super.key});
  final List<Kpi> items;

  Widget _cell(Kpi kpi) => Padding(
    padding: const EdgeInsets.fromLTRB(Space.lg, 18, Space.lg, 18),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Text(kpi.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 13, fontWeight: FontWeight.w500)),
      const SizedBox(height: 6),
      FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft,
        child: Text(kpi.value, style: (kpi.lead ? moneyStyle : amountStyle).copyWith(fontSize: kpi.lead ? 30 : 22, color: kpi.color ?? ink, height: 1.15))),
      if (kpi.caption != null) ...[
        const SizedBox(height: 4),
        Text(kpi.caption!, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 12)),
      ],
    ]),
  );

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
    // one panel cut by hairlines, like the dashboard: up to four figures on a line on a PC,
    // three a line beyond that so none gets squeezed, two on a phone
    final perRow = box.maxWidth < 640 ? 2 : items.length > 4 ? 3 : items.length;
    final oneLine = perRow == items.length;
    return Container(
      decoration: BoxDecoration(color: surface, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel)),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var i = 0; i < items.length; i += perRow) ...[
          if (i > 0) const Divider(height: 1),
          IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (var j = i; j < i + perRow && j < items.length; j++) ...[
              if (j > i) const VerticalDivider(width: 1),
              Expanded(flex: oneLine && items[j].lead ? 4 : 3, child: _cell(items[j])),
            ],
          ])),
        ],
      ]),
    );
  });
}

/// The app's mark. With [logo] (the shop's own image, from Pengaturan) it shows that;
/// otherwise the default: a till receipt with a torn edge on a rounded wine tile.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 24, this.logo});
  final double size;
  final Uint8List? logo;
  @override
  Widget build(BuildContext context) {
    final image = logo;
    if (image != null) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.22),
        child: Image.memory(image, width: size, height: size, fit: BoxFit.cover, gaplessPlayback: true,
          errorBuilder: (_, _, _) => BrandMark(size: size)),
      );
    }
    return SizedBox(width: size, height: size, child: CustomPaint(painter: BrandMarkPainter(tile: dataHue)));
  }
}

/// [BrandMark]'s default, as a painter so the launcher icons are drawn from the same
/// shapes (see `tool/make_icons_test.dart`).
class BrandMarkPainter extends CustomPainter {
  const BrandMarkPainter({required this.tile, this.paper = Colors.white, this.inset = 0});
  final Color tile, paper;

  /// Fraction of the size left empty around the tile (Android crops adaptive icons).
  final double inset;

  @override
  void paint(Canvas canvas, Size size) {
    final pad = size.width * inset;
    final box = Rect.fromLTWH(pad, pad, size.width - pad * 2, size.height - pad * 2);
    final w = box.width, h = box.height;
    canvas.drawRRect(RRect.fromRectAndRadius(box, Radius.circular(w * 0.22)), Paint()..color = tile);

    // the receipt: a white slip with a torn bottom edge
    final left = box.left + w * 0.27, right = box.right - w * 0.27, top = box.top + h * 0.18, bottom = box.bottom - h * 0.16;
    const teeth = 4;
    final step = (right - left) / teeth;
    final slip = Path()..moveTo(left, top)..lineTo(right, top)..lineTo(right, bottom);
    for (var i = teeth; i > 0; i--) {
      slip.lineTo(left + step * (i - 0.5), bottom - h * 0.06);
      slip.lineTo(left + step * (i - 1), bottom);
    }
    slip.close();
    canvas.drawPath(slip, Paint()..color = paper..isAntiAlias = true);

    // printed lines, and a bold total
    final ink = Paint()..color = tile..strokeWidth = h * 0.045..strokeCap = StrokeCap.round;
    final x0 = left + w * 0.08, x1 = right - w * 0.08;
    canvas.drawLine(Offset(x0, top + h * 0.12), Offset(x1, top + h * 0.12), ink);
    canvas.drawLine(Offset(x0, top + h * 0.22), Offset(x1 - w * 0.1, top + h * 0.22), ink);
    canvas.drawLine(Offset(x0, top + h * 0.32), Offset(x1 - w * 0.04, top + h * 0.32), ink);
    canvas.drawLine(Offset(x0 + w * 0.12, top + h * 0.46), Offset(x1, top + h * 0.46), ink..strokeWidth = h * 0.075);
  }

  @override
  bool shouldRepaint(covariant BrandMarkPainter old) => old.tile != tile || old.paper != paper || old.inset != inset;
}

class PageIntro extends StatelessWidget {
  const PageIntro(this.title, this.description, {super.key});
  final String title, description;
  @override Widget build(BuildContext context) {
    // a phone already names the screen in its app bar, so the intro gets smaller there
    final phone = MediaQuery.sizeOf(context).width < 600;
    final style = Theme.of(context).textTheme.titleLarge;
    return Padding(
      padding: EdgeInsets.only(bottom: phone ? Space.lg : Space.xl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: phone ? style?.copyWith(fontSize: 20) : style),
        const SizedBox(height: Space.xs),
        Text(description, style: TextStyle(color: muted, fontSize: phone ? 13 : 14)),
      ]),
    );
  }
}

/// A bounded reading/form width that still fills the available scroll height.
class WorkArea extends StatelessWidget {
  const WorkArea({super.key, required this.child, this.maxWidth = double.infinity});
  final Widget child;
  final double maxWidth;
  // inner lists pad 16; on a PC 16 more puts the content on the same 32px left edge as ScreenBody
  @override Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final inner = maxWidth.isFinite
        ? Align(alignment: Alignment.topLeft, child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: child))
        : child;
    return Padding(
      padding: EdgeInsets.only(
        left: wide ? Space.lg : 0,
        top: wide ? Space.lg : 0,
        right: wide ? Space.lg : 0,
      ),
      child: inner,
    );
  }
}

/// The phone's cart bar: the count and the total, one tap to the cart.
class CartAction extends StatelessWidget {
  const CartAction({super.key, required this.count, required this.total, required this.onPressed});
  final int count;
  final String total;
  final VoidCallback onPressed;
  @override Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.lg, Space.md),
    decoration: BoxDecoration(color: surface, border: Border(top: BorderSide(color: lineColor))),
    child: SizedBox(width: double.infinity, height: 48, child: FilledButton(onPressed: onPressed,
      child: Row(children: [
        Expanded(child: Text('Keranjang · $count barang', maxLines: 1, overflow: TextOverflow.ellipsis)),
        const SizedBox(width: Space.sm),
        ConstrainedBox(constraints: const BoxConstraints(maxWidth: 160), child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child: Text(total, style: moneyStyle.copyWith(color: onPrimary, fontSize: 16)))),
      ]))),
  );
}

class CartLayout extends StatelessWidget {
  const CartLayout({
    super.key,
    required this.header,
    required this.items,
    required this.footer,
    this.scrollController,
  });
  final Widget header, footer;
  final List<Widget> items;
  final ScrollController? scrollController;
  @override Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
    final compact = box.maxHeight < 560 || MediaQuery.textScalerOf(context).scale(14) > 20;
    final contents = items.isEmpty ? <Widget>[Padding(padding: EdgeInsets.symmetric(vertical: Space.xl),
      child: Text('Keranjang masih kosong. Scan barang atau pilih dari katalog.', style: TextStyle(color: muted)))] : items;
    return Material(color: surface, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.panel), side: BorderSide(color: lineColor)),
      clipBehavior: Clip.antiAlias, child: compact
      ? ListView(controller: scrollController, padding: const EdgeInsets.all(Space.lg), children: [header, const Divider(), ...contents, const Divider(), footer])
      : Column(children: [Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.md, Space.md), child: header), const Divider(),
          Expanded(child: ListView(controller: scrollController, padding: const EdgeInsets.symmetric(horizontal: Space.lg), children: contents)),
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
      padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: 14),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: ruleColor))),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 3), Text(subtitle, style: TextStyle(color: muted, fontSize: 13)),
        ])),
        if (value != null) Text(value!, style: amountStyle.copyWith(fontSize: 14)),
        if (onTap != null) Padding(padding: EdgeInsets.only(left: Space.sm), child: Icon(Icons.chevron_right, size: 18, color: muted)),
      ]),
    )),
  );
}

class PaymentTotal extends StatelessWidget {
  const PaymentTotal({super.key, required this.total, required this.description});
  final String total, description;
  @override Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text('Total yang dibayar', style: TextStyle(color: muted, fontSize: 14)),
    const SizedBox(height: Space.xs),
    FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(total, style: moneyStyle.copyWith(fontSize: 30, color: dataHue))),
    const SizedBox(height: Space.xs), Text(description, style: TextStyle(color: muted, fontSize: 12)),
    const SizedBox(height: Space.xl),
  ]);
}
