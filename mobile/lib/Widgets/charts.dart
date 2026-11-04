import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Rupiah on an axis: short, so the ticks stay quieter than the data ("250 rb", "1,5 jt").
String axisRupiah(num value) {
  if (value == 0) return '0';
  if (value >= 1000000) {
    final jt = value / 1000000;
    return '${jt == jt.roundToDouble() ? jt.toInt() : jt.toStringAsFixed(1).replaceAll('.', ',')} jt';
  }
  if (value >= 1000) return '${(value / 1000).round()} rb';
  return value.round().toString();
}

/// A round step so 3-5 ticks land above [max]: 1, 2, 2.5 or 5 times a power of ten.
double niceStep(num max, {int ticks = 4}) {
  if (max <= 0) return 1;
  final raw = max / ticks;
  final power = math.pow(10, (math.log(raw) / math.ln10).floor()).toDouble();
  for (final m in [1.0, 2.0, 2.5, 5.0, 10.0]) {
    if (raw <= m * power) return m * power;
  }
  return 10 * power;
}

/// One hour's bar.
class HourValue {
  const HourValue(this.hour, this.value, {this.count = 0});
  final int hour;
  final num value;
  final int count;
}

/// Today's takings by the hour: square columns in the shop's one hue, the same hour of a
/// comparison day as a short grey tick on the same scale, 3-5 faint gridlines, round
/// ticks above the maximum, flat x labels every two hours. The hours run from the shop's
/// usual opening (07.00) to its closing (21.00), wider if a sale fell outside them.
class HourlyBars extends StatelessWidget {
  const HourlyBars({super.key, required this.today, required this.comparison, this.currentHour, this.height = 200});
  final List<HourValue> today, comparison;

  /// Hours after this one have not happened yet and stay empty.
  final int? currentHour;
  final double height;

  @override
  Widget build(BuildContext context) {
    final hours = [...today, ...comparison].map((h) => h.hour);
    final first = math.min(7, hours.isEmpty ? 7 : hours.reduce(math.min));
    final last = math.max(21, hours.isEmpty ? 21 : hours.reduce(math.max));
    final peak = [...today, ...comparison].fold<num>(0, (m, h) => math.max(m, h.value));
    final step = niceStep(peak);
    final top = peak <= 0 ? step * 4 : (peak / step).ceil() * step + (peak % step == 0 ? step : 0);
    return Semantics(
      label: 'Penjualan per jam hari ini: ${today.map((h) => 'jam ${h.hour}, ${h.value.round()} rupiah').join('; ')}',
      child: SizedBox(height: height, width: double.infinity, child: CustomPaint(painter: _HourlyPainter(
        first: first, last: last, top: top.toDouble(), step: step,
        today: {for (final h in today) h.hour: h.value}, comparison: {for (final h in comparison) h.hour: h.value},
        currentHour: currentHour))),
    );
  }
}

class _HourlyPainter extends CustomPainter {
  _HourlyPainter({required this.first, required this.last, required this.top, required this.step, required this.today, required this.comparison, this.currentHour});
  final int first, last;
  final double top, step;
  final Map<int, num> today, comparison;
  final int? currentHour;

  static const _axisStyle = TextStyle(fontFamily: fontFamily, fontSize: 12, color: muted, fontFeatures: [FontFeature.tabularFigures()]);

  TextPainter _text(String value, [TextStyle style = _axisStyle]) => TextPainter(text: TextSpan(text: value, style: style), textDirection: TextDirection.ltr)..layout();

  @override
  void paint(Canvas canvas, Size size) {
    const xLabelBand = 22.0;
    final ticks = <double>[for (var v = 0.0; v <= top + 0.001; v += step) v];
    final yLabels = ticks.map((v) => _text(axisRupiah(v))).toList();
    final yLane = yLabels.fold<double>(0, (w, t) => math.max(w, t.width)) + 10;
    final plot = Rect.fromLTRB(yLane, 6, size.width, size.height - xLabelBand);
    double y(num v) => plot.bottom - (v / top) * plot.height;

    final grid = Paint()..color = const Color(0xFFEDEDED)..strokeWidth = 1;
    for (var i = 0; i < ticks.length; i++) {
      final ty = y(ticks[i]);
      if (i > 0) canvas.drawLine(Offset(plot.left, ty), Offset(plot.right, ty), grid);
      yLabels[i].paint(canvas, Offset(yLane - 10 - yLabels[i].width, ty - yLabels[i].height / 2));
    }

    final slots = last - first + 1;
    final slot = plot.width / slots;
    final barWidth = math.min(28.0, slot * 0.62);
    final bar = Paint()..color = dataHue;
    final tick = Paint()..color = const Color(0xFF8A8A8A)..strokeWidth = 2;
    for (var hour = first; hour <= last; hour++) {
      final cx = plot.left + slot * (hour - first + 0.5);
      final value = today[hour];
      if (value != null && value > 0) {
        canvas.drawRect(Rect.fromLTRB(cx - barWidth / 2, y(value), cx + barWidth / 2, plot.bottom), bar);
      }
      final before = comparison[hour];
      if (before != null && before > 0) {
        canvas.drawLine(Offset(cx - barWidth / 2 - 3, y(before)), Offset(cx + barWidth / 2 + 3, y(before)), tick);
      }
      if ((hour - first) % 2 == 0) {
        final isNow = hour == currentHour;
        final label = _text('${hour.toString().padLeft(2, '0')}.00', isNow ? _axisStyle.copyWith(color: ink, fontWeight: FontWeight.w500) : _axisStyle);
        final lx = (cx - label.width / 2).clamp(plot.left, size.width - label.width);
        label.paint(canvas, Offset(lx, plot.bottom + 6));
      }
    }
    // the baseline: the one heavier line
    canvas.drawLine(Offset(plot.left, plot.bottom), Offset(plot.right, plot.bottom), Paint()..color = const Color(0xFFBDBDBD)..strokeWidth = 1);
  }

  @override
  bool shouldRepaint(covariant _HourlyPainter old) => old.today != today || old.comparison != comparison || old.top != top;
}

/// A share of a whole as one bar split by 2px seams, each part its own mark; the legend
/// under it is a small table (mark, name, value) so it carries the figures.
class SplitBar extends StatelessWidget {
  const SplitBar({super.key, required this.parts});
  final List<SplitPart> parts;
  @override
  Widget build(BuildContext context) {
    final total = parts.fold<num>(0, (s, p) => s + p.value);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      ClipRRect(borderRadius: BorderRadius.circular(3), child: SizedBox(height: 14, child: total <= 0
        ? Container(color: ruleColor)
        : Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (final (i, p) in parts.where((p) => p.value > 0).indexed) ...[
              if (i > 0) const SizedBox(width: 2),
              Expanded(flex: math.max(1, (p.value / total * 1000).round()), child: CustomPaint(painter: _MarkPainter(p.mark))),
            ],
          ]))),
    ]);
  }
}

enum PartMark { solid, grey, hatched }

class SplitPart {
  const SplitPart(this.label, this.value, this.mark, {this.caption});
  final String label;
  final num value;
  final PartMark mark;
  final String? caption;
}

/// The swatch is the mark itself, scaled down.
class PartSwatch extends StatelessWidget {
  const PartSwatch(this.mark, {super.key});
  final PartMark mark;
  @override
  Widget build(BuildContext context) => SizedBox(width: 10, height: 10, child: CustomPaint(painter: _MarkPainter(mark)));
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(this.mark);
  final PartMark mark;
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    switch (mark) {
      case PartMark.solid:
        canvas.drawRect(rect, Paint()..color = ink);
      case PartMark.grey:
        canvas.drawRect(rect, Paint()..color = const Color(0xFFB5B5B5));
      case PartMark.hatched:
        canvas.drawRect(rect, Paint()..color = surface);
        canvas.save();
        canvas.clipRect(rect);
        final line = Paint()..color = const Color(0xFF8A8A8A)..strokeWidth = 1;
        for (var x = -size.height; x < size.width; x += 4) {
          canvas.drawLine(Offset(x, size.height), Offset(x + size.height, 0), line);
        }
        canvas.restore();
        canvas.drawRect(rect.deflate(0.5), Paint()..color = const Color(0xFF8A8A8A)..style = PaintingStyle.stroke..strokeWidth = 1);
    }
  }
  @override
  bool shouldRepaint(covariant _MarkPainter old) => old.mark != mark;
}

/// Columns per period on one round scale with zero as the baseline: square columns in the
/// shop's one hue, a column below zero in the negative colour (a loss is a fact, not a
/// texture). 3-5 faint gridlines, flat x labels thinned to fit.
class ColumnChart extends StatelessWidget {
  const ColumnChart({super.key, required this.labels, required this.values, this.height = 200, this.semanticLabel = ''});
  final List<String> labels;
  final List<num> values;
  final double height;
  final String semanticLabel;
  @override
  Widget build(BuildContext context) {
    final high = values.fold<num>(0, math.max);
    final low = values.fold<num>(0, math.min);
    final step = niceStep(math.max(high, -low) == 0 ? 1 : (high - low), ticks: 4);
    final top = high <= 0 ? 0.0 : ((high / step).floor() + 1) * step;
    final bottom = low >= 0 ? 0.0 : -((-low / step).floor() + 1) * step;
    return Semantics(label: semanticLabel, child: SizedBox(height: height, width: double.infinity,
      child: CustomPaint(painter: _ColumnPainter(labels: labels, values: values, top: top == 0 && bottom == 0 ? step : top, bottom: bottom, step: step))));
  }
}

class _ColumnPainter extends CustomPainter {
  _ColumnPainter({required this.labels, required this.values, required this.top, required this.bottom, required this.step});
  final List<String> labels;
  final List<num> values;
  final double top, bottom, step;

  static const _axisStyle = TextStyle(fontFamily: fontFamily, fontSize: 12, color: muted, fontFeatures: [FontFeature.tabularFigures()]);
  TextPainter _text(String value) => TextPainter(text: TextSpan(text: value, style: _axisStyle), textDirection: TextDirection.ltr)..layout();

  @override
  void paint(Canvas canvas, Size size) {
    const xBand = 22.0;
    final ticks = <double>[for (var v = bottom; v <= top + 0.001; v += step) v];
    final yLabels = ticks.map((v) => _text(v < 0 ? '-${axisRupiah(-v)}' : axisRupiah(v))).toList();
    final lane = yLabels.fold<double>(0, (w, t) => math.max(w, t.width)) + 10;
    final plot = Rect.fromLTRB(lane, 6, size.width, size.height - xBand);
    double y(num v) => plot.bottom - ((v - bottom) / (top - bottom)) * plot.height;
    final grid = Paint()..color = const Color(0xFFEDEDED)..strokeWidth = 1;
    for (var i = 0; i < ticks.length; i++) {
      final ty = y(ticks[i]);
      if (ticks[i] != 0) canvas.drawLine(Offset(plot.left, ty), Offset(plot.right, ty), grid);
      yLabels[i].paint(canvas, Offset(lane - 10 - yLabels[i].width, ty - yLabels[i].height / 2));
    }
    if (values.isEmpty) {
      canvas.drawLine(Offset(plot.left, y(0)), Offset(plot.right, y(0)), Paint()..color = const Color(0xFFBDBDBD));
      return;
    }
    final slot = plot.width / values.length;
    final width = math.min(24.0, slot * 0.66);
    final every = math.max(1, (values.length / math.max(1, plot.width ~/ 64)).ceil());
    for (var i = 0; i < values.length; i++) {
      final cx = plot.left + slot * (i + 0.5);
      final v = values[i];
      if (v != 0) {
        canvas.drawRect(Rect.fromLTRB(cx - width / 2, math.min(y(v), y(0)), cx + width / 2, math.max(y(v), y(0))), Paint()..color = v < 0 ? errorColor : dataHue);
      }
      if (i % every == 0) {
        final label = _text(labels[i]);
        label.paint(canvas, Offset((cx - label.width / 2).clamp(plot.left, size.width - label.width), plot.bottom + 6));
      }
    }
    canvas.drawLine(Offset(plot.left, y(0)), Offset(plot.right, y(0)), Paint()..color = const Color(0xFFBDBDBD));
  }

  @override
  bool shouldRepaint(covariant _ColumnPainter old) => old.values != values;
}
