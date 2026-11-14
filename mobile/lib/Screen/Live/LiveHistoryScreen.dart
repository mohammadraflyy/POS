import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/business_api.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveSaleScreen.dart';
import 'kasir_style.dart';
import '../../Widgets/admin.dart';
class LiveHistoryScreen extends StatefulWidget {
  const LiveHistoryScreen({super.key, required this.api, this.isAdmin = false, this.onEditSale});

  /// Loads a nota into the till for editing; admins only.
  final Future<void> Function(int saleId)? onEditSale;
  final BusinessApi api;
  final bool isAdmin;
  @override State<LiveHistoryScreen> createState() => _LiveHistoryScreenState();
}
class _LiveHistoryScreenState extends State<LiveHistoryScreen> {
  List<Map<String, dynamic>> rows = [];
  String query = '', method = '', status = '';
  DateTimeRange? range;
  int page = 1, last = 1, serial = 0;

  /// The row the arrow keys are on; -1 until one is picked.
  int hi = -1;
  bool loading = true;
  String? error;
  Timer? timer;
  final searchFocus = FocusNode();
  @override void initState() { super.initState(); HardwareKeyboard.instance.addHandler(handleKey); load(); }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); timer?.cancel(); searchFocus.dispose(); rowsFocus.dispose(); super.dispose(); }

  /// Holds focus while the arrow keys are on the rows, so no button or box takes the same key as well.
  final rowsFocus = FocusNode(skipTraversal: true);

  /// Keys handleKey already took: key events still reach the focus tree afterwards, where the defaults would move focus or scroll the page.
  static const _taken = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.arrowUp): DoNothingAndStopPropagationIntent(),
    SingleActivator(LogicalKeyboardKey.arrowDown): DoNothingAndStopPropagationIntent(),
    SingleActivator(LogicalKeyboardKey.pageUp): DoNothingAndStopPropagationIntent(),
    SingleActivator(LogicalKeyboardKey.pageDown): DoNothingAndStopPropagationIntent(),
  };

  /// The desktop's keys on the list: / jumps to the search; ↑↓, Home and End pick a row, Enter opens it, PgUp/PgDn turn the page.
  /// Typing keeps its own keys, except Esc (leave the box) and ↓ (down into the rows). Ctrl+arrows stay the menu's.
  bool handleKey(KeyEvent event) {
    if (event is KeyUpEvent || !mounted || ModalRoute.of(context)?.isCurrent == false) return false;
    final keyboard = HardwareKeyboard.instance;
    if (keyboard.isControlPressed || keyboard.isAltPressed || keyboard.isMetaPressed) return false;
    final key = event.logicalKey, down = event is KeyDownEvent;
    if (FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null) {
      if (down && key == LogicalKeyboardKey.escape) { rowsFocus.requestFocus(); return true; }
      if (key == LogicalKeyboardKey.arrowDown && rows.isNotEmpty) { rowsFocus.requestFocus(); setState(() => hi = 0); return true; }
      return false;
    }
    if (down && key == LogicalKeyboardKey.slash) { searchFocus.requestFocus(); return true; }
    if (rows.isEmpty) return false;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.arrowUp) {
      if (key == LogicalKeyboardKey.arrowUp && hi < 0) return false;
      if (key == LogicalKeyboardKey.arrowUp && hi == 0) { setState(() => hi = -1); searchFocus.requestFocus(); return true; }
      rowsFocus.requestFocus();
      setState(() => hi = (hi + (key == LogicalKeyboardKey.arrowDown ? 1 : -1)).clamp(0, rows.length - 1));
      return true;
    }
    if (!down) return false;
    if (key == LogicalKeyboardKey.home || key == LogicalKeyboardKey.end) {
      rowsFocus.requestFocus();
      setState(() => hi = key == LogicalKeyboardKey.home ? 0 : rows.length - 1);
      return true;
    }
    if (key == LogicalKeyboardKey.pageDown || key == LogicalKeyboardKey.pageUp) {
      final to = page + (key == LogicalKeyboardKey.pageDown ? 1 : -1);
      if (!loading && to >= 1 && to <= last) load(target: to);
      rowsFocus.requestFocus();
      return true;
    }
    if ((key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter) && rowsFocus.hasFocus && hi >= 0 && hi < rows.length) { _open(rows[hi]); return true; }
    return false;
  }
  Future<void> load({int target = 1}) async {
    final request = ++serial; setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.sales({'page': '$target', 'search': query, if (method.isNotEmpty) 'metodePembayaran': method, if (status.isNotEmpty) 'status': status,
        if (range != null) 'dari': isoDate(range!.start), if (range != null) 'sampai': isoDate(range!.end)});
      final parsed = jsonRows(data);
      if (mounted && request == serial) setState(() { hi = parsed.isEmpty || hi < 0 ? -1 : (target == page ? hi : 0).clamp(0, parsed.length - 1); rows = parsed; page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? target).toInt(); });
    } catch (e) { if (mounted && request == serial) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }
  static const _methods = {'': 'Semua', 'tunai': 'Tunai', 'qris': 'QRIS', 'transfer': 'Transfer', 'bon': 'Bon'};

  static String _status(Map<String, dynamic> row) {
    if (row['status'] == 'dibatalkan') return 'Dibatalkan';
    final sisa = (number(row['total']) ?? 0) - (number(row['dibayar']) ?? 0);
    if (row['metodePembayaran'] == 'bon' && sisa > 0) return 'Belum lunas · Sisa ${rupiah(sisa)}';
    return 'Selesai';
  }

  /// A bon still owing money: its row is washed yellow so it stands out in the list.
  static bool _openBon(Map<String, dynamic> row) => row['status'] != 'dibatalkan' && row['metodePembayaran'] == 'bon'
      && (number(row['total']) ?? 0) - (number(row['dibayar']) ?? 0) > 0;

  static String _itemsSummary(Map<String, dynamic> row) {
    final items = row['items'];
    if (items is! List || items.isEmpty) return '—';
    final parts = <String>[];
    for (final raw in items.whereType<Map>()) {
      final name = (raw['namaItem'] ?? '').toString().trim();
      if (name.isEmpty) continue;
      parts.add('$name ×${quantityText(raw['qty'])}');
    }
    return parts.isEmpty ? '—' : parts.join(', ');
  }

  static Widget _statusBadge(Map<String, dynamic> r) {
    if (r['status'] == 'dibatalkan') return const Pill('Batal', color: Color(0xFFDC2626));
    final sisa = (number(r['total']) ?? 0) - (number(r['dibayar']) ?? 0);
    if (r['metodePembayaran'] == 'bon' && sisa > 0) return const Pill('Belum Lunas', color: Color(0xFFD97706));
    return const Pill('Lunas', color: Color(0xFF16A34A));
  }

  Future<void> _open(Map<String, dynamic> row) async {
    try {
      final id = idNumber(row['saleId'] ?? row['id']);
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LiveSaleScreen(api: widget.api, id: id, isAdmin: widget.isAdmin, onEdit: widget.onEditSale)));
      if (mounted) load(target: page);
    } catch (e) { if (mounted) showError(context, e); }
  }

  @override Widget build(BuildContext context) => Shortcuts(shortcuts: _taken, child: Focus(focusNode: rowsFocus, child: ScreenBody(onRefresh: () => load(target: page), children: [
    ScreenHeader('Riwayat penjualan', range == null ? 'Semua nota, terbaru di atas. Buka nota untuk cetak ulang atau bayar bon.' : 'Nota ${isoDate(range!.start)} sampai ${isoDate(range!.end)}.', actions: [
      OutlinedButton.icon(onPressed: () async { final selected = await showDateRangePicker(context: context, firstDate: DateTime(2000), lastDate: DateTime.now(), initialDateRange: range); if (selected != null && mounted) { range = selected; load(); } },
        icon: const Icon(Icons.date_range, size: 18), label: Text(range == null ? 'Semua tanggal' : '${isoDate(range!.start)} – ${isoDate(range!.end)}')),
      if (range != null) TextButton(onPressed: () { range = null; load(); }, child: const Text('Hapus tanggal')),
    ]),
    TextField(focusNode: searchFocus, onChanged: (v) { query = v; serial++; timer?.cancel(); setState(() => loading = true); timer = Timer(const Duration(milliseconds: 350), () => load()); },
      decoration: const InputDecoration(hintText: 'Cari nomor nota atau nama pelanggan', prefixIcon: Icon(Icons.search, size: 20))),
    const SizedBox(height: Space.md),
    // one line of filters that scrolls sideways, not three wrapped rows on a phone: the method
    // chips, then the cancelled-note filter as a single dropdown
    SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
      for (final entry in _methods.entries) Padding(padding: const EdgeInsets.only(right: Space.sm),
        child: ChoiceChip(label: Text(entry.value), selected: method == entry.key, showCheckmark: false, onSelected: (_) { method = entry.key; load(); })),
      const SizedBox(width: Space.xs),
      DropdownButton<String>(value: status, underline: const SizedBox(), borderRadius: BorderRadius.circular(Corners.control),
        items: const [
          DropdownMenuItem(value: '', child: Text('Semua status')),
          DropdownMenuItem(value: 'selesai', child: Text('Tanpa yang batal')),
          DropdownMenuItem(value: 'dibatalkan', child: Text('Hanya yang batal')),
        ],
        onChanged: (v) { status = v ?? ''; load(); }),
    ])),
    const SizedBox(height: Space.md),
    if (isDesktop) Padding(padding: const EdgeInsets.only(bottom: Space.sm), child: Wrap(spacing: 20, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
      for (final (keys, action) in const [('/', 'cari'), ('↑↓', 'pilih'), ('Enter', 'buka'), ('PgUp/PgDn', 'halaman')])
        Row(mainAxisSize: MainAxisSize.min, children: [KasirKey(keys), const SizedBox(width: 6), Text(action, style: TextStyle(fontSize: 12, color: KasirColors.label))]),
    ])),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    if (error != null) EmptyPanel(icon: Icons.wifi_off, title: 'Riwayat belum dimuat', message: error!, action: OutlinedButton(onPressed: () => load(), child: const Text('Coba lagi')))
    else if (!loading && rows.isEmpty) const EmptyPanel(icon: Icons.receipt_long_outlined, title: 'Tidak ada nota', message: 'Tidak ada nota yang cocok dengan pencarian atau filter ini.')
    else if (rows.isNotEmpty) DataView<Map<String, dynamic>>(rows: rows, onTap: _open, rowColor: (r) => _openBon(r) ? pillWarningBg : null, highlightedIndex: hi < 0 ? null : hi, actions: (r) => [_statusBadge(r)], actionsWidth: 110, columns: [
      DataCol('Nota', (r) => r['nomorNota']?.toString() ?? '#${r['saleId'] ?? r['id'] ?? ''}'),
      DataCol('Waktu', (r) => dateTimeLabel(r['createdAt'] ?? r['tanggal']), flex: 2),
      DataCol('Pelanggan', (r) => text(r['namaPelanggan'], 'Umum'), flex: 2),
      DataCol('Barang', _itemsSummary, flex: 2),
      DataCol('Metode', (r) => _methods[r['metodePembayaran']] ?? text(r['metodePembayaran'])),
      DataCol('Status', _status, flex: 2),
      DataCol('Total', (r) => rupiah(r['total']), numeric: true, flex: 2, headline: true),
      DataCol('Laba', (r) => r['status'] == 'dibatalkan' ? '—' : rupiah(r['laba']), numeric: true, flex: 2,
        color: (r) => r['status'] == 'dibatalkan' ? null : profitColor(number(r['laba']))),
    ]),
    Pager(page: page, last: last, busy: loading, onPage: (p) => load(target: p)),
  ])));
}
