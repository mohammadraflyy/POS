import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/charts.dart';

const _hari = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const _bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
String _tanggalPanjang(DateTime d) => '${_hari[d.weekday - 1]}, ${d.day} ${_bulan[d.month - 1]}';
String _tanggalPendek(DateTime d) => '${_hari[d.weekday - 1]} ${d.day} ${_bulan[d.month - 1].substring(0, 3)}';
String _jam(int hour) => '${hour.toString().padLeft(2, '0')}.00';
String _formatJam(DateTime d) =>
    '${d.hour.toString().padLeft(2, '0')}.${d.minute.toString().padLeft(2, '0')}.${d.second.toString().padLeft(2, '0')}';

/// The shop's day. Its one question: "how much money came in today, and where is it?"
/// The answer is the biggest figure, with the drawer strip (cash in the drawer, QRIS and
/// transfer in the bank, bon sold today with nothing paid yet) right under it, and the
/// hours beside last week's as the evidence.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.api, this.active = true});
  final StoreApi api;
  final bool active;
  @override State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? data;
  DateTime? loadedAt;
  bool loading = true;
  String? error;
  Timer? _refreshTimer;
  bool _fetching = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
    _syncTimer();
  }

  @override
  void didUpdateWidget(covariant DashboardScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active != oldWidget.active) {
      _syncTimer();
      if (widget.active) {
        load(silent: data != null);
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (widget.active) {
        load(silent: data != null);
        _startTimer();
      }
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      _stopTimer();
    }
  }

  void _syncTimer() {
    if (widget.active) {
      _startTimer();
    } else {
      _stopTimer();
    }
  }

  void _startTimer() {
    _stopTimer();
    _refreshTimer = Timer.periodic(const Duration(seconds: 8), (_) {
      if (mounted && widget.active && !_fetching) {
        load(silent: true);
      }
    });
  }

  void _stopTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }

  @override
  void dispose() {
    _stopTimer();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> load({bool silent = false}) async {
    if (_fetching) return;
    _fetching = true;
    if (!silent) {
      setState(() { loading = data == null; error = null; });
    }
    try {
      final result = await widget.api.dashboard();
      if (mounted) {
        setState(() {
          data = result;
          loadedAt = DateTime.now();
          error = null;
        });
      }
    } catch (e) {
      if (mounted && (!silent || data == null)) {
        setState(() => error = e.toString());
      }
    } finally {
      _fetching = false;
      if (mounted) setState(() => loading = false);
    }
  }

  @override Widget build(BuildContext context) {
    final now = DateTime.now();
    final summary = data?['summary'] is Map ? jsonObject(data!['summary']) : const <String, dynamic>{};
    final perJam = data?['perJam'] is Map ? jsonObject(data!['perJam']) : const <String, dynamic>{};
    List<HourValue> hours(Object? rows) => rows is List
      ? [for (final r in rows.whereType<Map>()) HourValue((number(r['jam']) ?? 0).toInt(), number(r['nilai']) ?? 0, count: (number(r['nota']) ?? 0).toInt())]
      : const [];
    final today = hours(perJam['hariIni']);
    final before = hours(perJam['pembanding']);
    final compareDate = DateTime.tryParse(perJam['tanggalPembanding']?.toString() ?? '');

    // one variable per fact: the note count and the busiest hour come from the same rows
    final notes = today.fold<int>(0, (s, h) => s + h.count);
    final busiest = today.isEmpty ? null : today.reduce((a, b) => b.value > a.value ? b : a);
    final tunai = number(summary['omzetTunai']) ?? 0;
    final nonTunai = number(summary['omzetNonTunai']) ?? 0;
    final bonBaru = number(data?['bonBaruBelumDibayar']) ?? 0;
    final masuk = tunai + nonTunai;
    final laba = number(summary['labaKotor']) ?? 0;

    final lowStock = data == null ? const <Map<String, dynamic>>[] : jsonRows(data!['stokMenipis']);
    final thinnest = data?['stokTerendah'] is List ? jsonRows(data!['stokTerendah']) : const <Map<String, dynamic>>[];
    final topProducts = data == null ? const <Map<String, dynamic>>[] : jsonRows(data!['produkTerlarisHariIni']).take(5).toList();
    final latest = data == null ? const <Map<String, dynamic>>[] : jsonRows(data!['transaksiTerbaru']).take(5).toList();

    final finding = data == null ? _tanggalPanjang(now) : notes == 0
      ? '${_tanggalPanjang(now)} · belum ada nota hari ini'
      : '${_tanggalPanjang(now)} · $notes nota · jam tersibuk ${_jam(busiest!.hour)} (${rupiah(busiest.value)})';

    final money = SectionCard(title: 'Uang hari ini', padded: false,
      trailing: loadedAt == null ? null : Text('diperbarui ${_formatJam(loadedAt!)}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Divider(),
        _MoneyFigures(masuk: masuk, laba: laba, notes: notes, piutang: number(summary['piutangBeredar']) ?? 0),
        const Divider(),
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, 14, Space.lg, 4), child: SplitBar(parts: [
          SplitPart('Tunai di laci', tunai, PartMark.solid),
          SplitPart('QRIS & transfer', nonTunai, PartMark.grey),
          SplitPart('Bon baru, belum dibayar', bonBaru, PartMark.hatched),
        ])),
        LedgerRow(first: true, leading: const PartSwatch(PartMark.solid), label: 'Tunai di laci', subline: 'termasuk pelunasan bon lama', value: rupiah(tunai)),
        LedgerRow(leading: const PartSwatch(PartMark.grey), label: 'QRIS & transfer', subline: 'masuk rekening toko', value: rupiah(nonTunai)),
        LedgerRow(leading: const PartSwatch(PartMark.hatched), label: 'Bon baru, belum dibayar', subline: 'terjual hari ini, uangnya belum ada', value: rupiah(bonBaru)),
        const SizedBox(height: 6),
      ]));

    final chart = SectionCard(title: 'Penjualan per jam',
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 10, height: 10, color: dataHue), const SizedBox(width: 6), const Text('Hari ini'),
        const SizedBox(width: Space.md),
        Container(width: 12, height: 2, color: comparisonInk), const SizedBox(width: 6),
        Text(compareDate == null ? 'Minggu lalu' : _tanggalPendek(compareDate)),
      ]),
      child: HourlyBars(today: today, comparison: before, currentHour: now.hour, height: 220));

    // nothing low yet: the card still lists the thinnest lines, as reference, not as alarm
    final stockRows = (lowStock.isEmpty ? thinnest : lowStock).take(5).toList();
    final stock = SectionCard(title: 'Stok menipis', padded: false,
      trailing: Text(lowStock.isEmpty ? 'tidak ada di bawah 5' : '${lowStock.length} barang di bawah 5'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (lowStock.isEmpty && stockRows.isNotEmpty) Padding(padding: EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, 6),
          child: Text('Stok paling sedikit saat ini:', style: TextStyle(color: muted, fontSize: 12))),
        for (final (i, r) in stockRows.indexed) LedgerRow(first: i == 0, label: text(r['namaItem']), subline: text(r['kodeItem']),
          value: '${quantityText(r['stok'])} ${text(r['satuan'], '')}', valueColor: (number(r['stok']) ?? 0) <= 0 ? errorColor : ink),
      ]));

    final best = SectionCard(title: 'Paling laku hari ini', padded: false,
      trailing: const Text('nilai nota'),
      child: topProducts.isEmpty
        ? Padding(padding: EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.lg), child: Text('Belum ada barang terjual hari ini.', style: TextStyle(color: muted)))
        : Column(children: [for (final (i, r) in topProducts.indexed) LedgerRow(first: i == 0, label: text(r['namaItem']),
            subline: '${quantityText(r['qtyTerjual'])} terjual', value: rupiah(r['totalPenjualan']))]));

    final recent = SectionCard(title: 'Nota terakhir', padded: false,
      child: latest.isEmpty
        ? Padding(padding: EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.lg), child: Text('Belum ada nota.', style: TextStyle(color: muted)))
        : Column(children: [for (final (i, r) in latest.indexed) LedgerRow(first: i == 0,
            label: text(r['itemSummary']),
            subline: '${_saleTime(r['createdAt'])} · ${metodeLabel[r['metodePembayaran']] ?? text(r['metodePembayaran'])}${_bonStatus(r)}',
            value: rupiah(r['total']))]));

    return ScreenBody(onRefresh: load, children: [
      ScreenHeader('Hari ini', finding, actions: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: const Color(0xFFE8F5E9),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFA5D6A7)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: Color(0xFF2E7D32),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
              const Text(
                'Realtime',
                style: TextStyle(
                  color: Color(0xFF1B5E20),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        OutlinedButton.icon(
          onPressed: () => load(),
          icon: const Icon(Icons.refresh, size: 18),
          label: const Text('Muat ulang'),
        ),
      ]),
      LoadSwitch(loading: loading, error: error, onRetry: load, child: LayoutBuilder(builder: (context, box) {
        final wide = box.maxWidth >= 900;
        if (!wide) {
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            money, const SizedBox(height: Space.gap), chart, const SizedBox(height: Space.gap),
            best, const SizedBox(height: Space.gap), recent, const SizedBox(height: Space.gap), stock,
          ]);
        }
        // three bands on one 12-column grid: money full width; the hours (8) beside the best
        // sellers (4); the last notes (8) beside low stock (4) - five rows each, so the pairs end level
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          money,
          const SizedBox(height: Space.gap),
          IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(flex: 8, child: chart), const SizedBox(width: Space.gap), Expanded(flex: 4, child: best),
          ])),
          const SizedBox(height: Space.gap),
          IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(flex: 8, child: recent), const SizedBox(width: Space.gap), Expanded(flex: 4, child: stock),
          ])),
        ]);
      })),
    ]);
  }

  static String _saleTime(Object? iso) {
    final parsed = DateTime.tryParse(iso?.toString() ?? '');
    return parsed == null ? '—' : timeText(parsed.toLocal());
  }

  static String _bonStatus(Map<String, dynamic> r) {
    if (r['status'] == 'dibatalkan') return ' · batal';
    if (r['metodePembayaran'] != 'bon') return '';
    return (number(r['dibayar']) ?? 0) < (number(r['total']) ?? 0) ? ' · belum lunas' : ' · lunas';
  }
}

/// The headline figures as type: money in first and largest, then the day's margin,
/// note count and all outstanding bon, split by hairlines.
class _MoneyFigures extends StatelessWidget {
  const _MoneyFigures({required this.masuk, required this.laba, required this.notes, required this.piutang});
  final num masuk, laba, piutang;
  final int notes;
  @override Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
    Widget cell(String label, String value, {String? caption, bool lead = false, Color? color}) => Padding(
      padding: const EdgeInsets.fromLTRB(Space.lg, 18, Space.lg, 18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(color: muted, fontSize: 13, fontWeight: FontWeight.w500)),
        const SizedBox(height: 6),
        FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft,
          child: Text(value, style: (lead ? moneyStyle : amountStyle).copyWith(fontSize: lead ? 32 : 22, color: color ?? ink, height: 1.15))),
        if (caption != null) ...[const SizedBox(height: 4), Text(caption, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 12))],
      ]));
    final lead = cell('Uang masuk', rupiah(masuk), caption: 'tunai + QRIS + transfer', lead: true);
    final rest = [
      cell('Laba kotor', rupiah(laba), caption: 'dari uang yang masuk', color: laba < 0 ? errorColor : ink),
      cell('Nota', '$notes', caption: notes == 0 ? 'belum ada penjualan' : 'hari ini'),
      cell('Piutang bon', rupiah(piutang), caption: 'semua pelanggan, belum lunas'),
    ];
    if (box.maxWidth < 600) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        lead, const Divider(),
        IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: rest[0]), const VerticalDivider(width: 1), Expanded(child: rest[1])])),
        const Divider(), rest[2],
      ]);
    }
    return IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(flex: 5, child: lead),
      for (final c in rest) ...[const VerticalDivider(width: 1), Expanded(flex: 3, child: c)],
    ]));
  });
}
