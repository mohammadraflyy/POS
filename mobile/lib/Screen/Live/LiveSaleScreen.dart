import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/format.dart';
import '../../models/live_models.dart';
import '../../services/business_api.dart';
import '../../services/mobile_api.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../Widgets/receipt_preview.dart';
import '../../services/store_api.dart';
import '../Toko/BonActions.dart';
import '../../Widgets/admin.dart' show dateTimeLabel, isDesktop, metodeLabel, text;
import 'kasir_style.dart';
class LiveSaleScreen extends StatefulWidget {
  const LiveSaleScreen({super.key, required this.api, required this.id, this.confirmation, this.isAdmin = false, this.onEdit});

  /// "Ubah nota": loads this sale into the till. Null where editing is not offered.
  final Future<void> Function(int saleId)? onEdit;
  final BusinessApi api;
  final int id;
  final Map<String, dynamic>? confirmation;
  /// Admin-only actions (cancel, delete) show only for admins; bon actions for everyone.
  final bool isAdmin;
  @override State<LiveSaleScreen> createState() => _LiveSaleScreenState();
}
class _LiveSaleScreenState extends State<LiveSaleScreen> {
  Map<String, dynamic>? detail;
  String? error, printError;
  bool loading = true, printing = false;
  bool? printed;

  static const _maxActions = 8;
  static const _rowHeight = 52.0;
  final _items = FocusNode(skipTraversal: true);
  final _actionNodes = List.generate(_maxActions, (_) => FocusNode());
  final _scroll = ScrollController();

  /// The highlighted line while [_items] has focus.
  int _row = 0;

  /// The action the arrows last stood on: a notice takes the focus off the page, and the arrows carry on from here.
  int _stop = 0;

  /// The cashier chose no receipt: not a printer failure, nothing to warn about.
  bool get printSkipped => widget.confirmation?['printSkipped'] == true && printed != true;
  @override void initState() {
    super.initState(); HardwareKeyboard.instance.addHandler(_handleKey); printed = widget.confirmation?['printed'] as bool?;
    printError = widget.confirmation?['printError']?.toString(); load();
    if (widget.confirmation != null) WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (printSkipped) {
        showNotice(context, 'Penjualan berhasil disimpan tanpa struk.', title: 'Penjualan tersimpan', kind: NoticeKind.success);
        return;
      }
      showNotice(context, printed == true
        ? 'Penjualan berhasil disimpan. Struk dikirim ke printer PC.'
        : 'Penjualan sudah tersimpan, tetapi struk belum tercetak. Jangan membuat penjualan lagi.',
        title: printed == true ? 'Penjualan tersimpan' : 'Struk belum tercetak',
        details: printError,
        actionLabel: printed == true ? null : 'Cetak ulang',
        onAction: printed == true ? null : printAgain,
        kind: printed == true ? NoticeKind.success : NoticeKind.warning);
    });
  }
  @override void dispose() {
    HardwareKeyboard.instance.removeHandler(_handleKey);
    _items.dispose(); _scroll.dispose();
    for (final node in _actionNodes) { node.dispose(); }
    super.dispose();
  }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.sale(widget.id);
      if (mounted) { setState(() => detail = data); WidgetsBinding.instance.addPostFrameCallback((_) => _settleFocus()); }
    }
    catch (e) { if (mounted) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> printAgain() async {
    if (printing) return; setState(() => printing = true);
    try { final result = await widget.api.printSale(widget.id); if (result['printed'] != true) throw const ApiFailure('Printer belum mengonfirmasi pencetakan.'); if (mounted) { setState(() { printed = true; printError = null; }); showNotice(context, 'Struk dikirim ke printer PC.', kind: NoticeKind.success); } }
    catch (e) { if (mounted) { setState(() { printed = false; printError = e.toString(); }); showError(context, e); } }
    finally { if (mounted) setState(() => printing = false); }
  }
  void _copyReceiptText() {
    final sale = _sale;
    if (sale == null) return;
    final lines = _lines;
    final buffer = StringBuffer();
    buffer.writeln('================================');
    buffer.writeln('POINT OF SALES — BUKTI TRANSAKSI');
    buffer.writeln('================================');
    buffer.writeln('Nota     : #${sale['nomorNota'] ?? sale['id'] ?? widget.id}');
    buffer.writeln('Waktu    : ${dateTimeLabel(sale['createdAt'] ?? sale['tanggal'])}');
    final cust = sale['namaPelanggan']?.toString().trim();
    if (cust != null && cust.isNotEmpty) buffer.writeln('Pelanggan: $cust');
    buffer.writeln('--------------------------------');
    for (final item in lines) {
      final name = item['namaItem'] ?? item['name'] ?? 'Barang';
      final q = quantityText(item['qty']);
      final unit = item['satuan'] ?? '';
      final sub = rupiah(item['subtotal']);
      buffer.writeln('$name');
      buffer.writeln('  $q $unit × ${rupiah(item['hargaJual'])} = $sub');
    }
    buffer.writeln('--------------------------------');
    buffer.writeln('Subtotal : ${rupiah(sale['subtotal'] ?? sale['total'])}');
    final disc = number(sale['diskon']) ?? 0;
    if (disc > 0) buffer.writeln('Diskon   : -${rupiah(disc)}');
    final charge = number(sale['biayaLain']) ?? 0;
    if (charge > 0) buffer.writeln('Biaya    : ${rupiah(charge)}');
    buffer.writeln('TOTAL    : ${rupiah(sale['total'])}');
    buffer.writeln('Metode   : ${(sale['metodePembayaran'] ?? 'Tunai').toString().toUpperCase()}');
    buffer.writeln('Dibayar  : ${rupiah(sale['dibayar'])}');
    final change = (number(sale['dibayar']) ?? 0) - (number(sale['total']) ?? 0);
    if (change > 0 && sale['metodePembayaran'] == 'tunai') {
      buffer.writeln('Kembali  : ${rupiah(change)}');
    }
    buffer.writeln('================================');
    buffer.writeln('Terima kasih telah berbelanja!');

    Clipboard.setData(ClipboardData(text: buffer.toString()));
    showNotice(context, 'Teks struk berhasil disalin! Anda dapat menempelkannya ke WhatsApp.', kind: NoticeKind.success);
  }

  void _showReceiptPreview(Map<String, dynamic> sale, List<Map> lines) {
    showReceiptPreviewDialog(
      context,
      storeName: 'Point of Sales',
      saleId: int.tryParse((sale['nomorNota'] ?? sale['id'] ?? widget.id).toString()) ?? widget.id,
      date: DateTime.tryParse((sale['tanggal'] ?? sale['createdAt'] ?? '').toString()) ?? DateTime.now(),
      cashier: sale['kasirName']?.toString(),
      customer: sale['namaPelanggan']?.toString(),
      items: lines.map((e) => Map<String, dynamic>.from(e)).toList(),
      subtotal: number(sale['subtotal']),
      discount: number(sale['diskon']),
      charge: number(sale['biayaLain']),
      total: number(sale['total'] ?? widget.confirmation?['total']),
      method: (sale['metodePembayaran'] ?? 'tunai').toString(),
      paid: number(sale['dibayar']),
      change: number(sale['kembalian']),
      remaining: sale['metodePembayaran'] == 'bon' ? ((number(sale['total']) ?? 0) - (number(sale['dibayar']) ?? 0)) : null,
      note: sale['keterangan']?.toString(),
    );
  }

  Map<String, dynamic>? get _sale => detail?['sale'] is Map ? jsonObject(detail!['sale']) : detail;
  List<Map> get _lines {
    final raw = detail?['items'] ?? _sale?['items'];
    return raw is List ? raw.whereType<Map>().toList() : <Map>[];
  }
  bool get _wide => MediaQuery.sizeOf(context).width >= 860;

  Future<void> _editInTill() async {
    try {
      await widget.onEdit!(widget.id);
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) { if (mounted) showError(context, e); }
  }

  /// Straight back to the till after a sale, one step back to the list otherwise.
  void _back() => widget.confirmation != null ? Navigator.of(context).popUntil((route) => route.isFirst) : Navigator.of(context).maybePop();

  /// The receipt actions beside the bon and admin ones SaleActions owns; Bayar bon leads the list.
  List<SaleCommand> _commands(Map<String, dynamic> sale, List<Map> lines) {
    final ops = widget.api is StoreApi
        ? SaleActions(api: widget.api as StoreApi, sale: sale, isAdmin: widget.isAdmin, onChanged: load, onDeleted: () { if (mounted) Navigator.of(context).pop(); }).commands(context)
        : const <SaleCommand>[];
    return [
      ...ops.where((c) => c.primary),
      SaleCommand(printing ? 'Mengirim ke printer…' : 'Cetak ulang di PC', Icons.print_outlined, printing ? null : printAgain, key: LogicalKeyboardKey.keyP, hint: 'cetak'),
      if (widget.onEdit != null && sale['status'] == 'selesai') SaleCommand('Ubah nota di kasir', Icons.edit_note, _editInTill, key: LogicalKeyboardKey.keyE, hint: 'ubah'),
      SaleCommand('Pratinjau struk', Icons.receipt_long_outlined, () => _showReceiptPreview(sale, lines), key: LogicalKeyboardKey.keyS, hint: 'struk'),
      SaleCommand('Salin teks struk', Icons.share_outlined, _copyReceiptText, key: LogicalKeyboardKey.keyC, hint: 'salin'),
      ...ops.where((c) => !c.primary),
    ];
  }

  /// The first action takes focus when the nota opens, and again when a reload removed the one that had it.
  void _settleFocus() {
    if (!mounted || !_wide || _sale == null || _items.hasFocus || _actionNodes.any((node) => node.hasFocus)) return;
    _actionNodes.first.requestFocus();
  }

  /// ↑↓ are ours on the wide page: key events still reach the focus tree after _handleKey, where the defaults would move focus a second time.
  static const _taken = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.arrowUp): DoNothingAndStopPropagationIntent(),
    SingleActivator(LogicalKeyboardKey.arrowDown): DoNothingAndStopPropagationIntent(),
  };

  /// Esc, the letter of an action and, on the wide page, ↑↓ through the lines then the actions and Enter on the focused action.
  /// The page has no text field, so every key is ours. A dialog on top is another route and a notice takes the focus off the page,
  /// so this listens to the keyboard rather than to the focus.
  bool _handleKey(KeyEvent event) {
    if (event is KeyUpEvent || !mounted || ModalRoute.of(context)?.isCurrent == false) return false;
    final keyboard = HardwareKeyboard.instance;
    if (keyboard.isControlPressed || keyboard.isAltPressed || keyboard.isMetaPressed) return false;
    final key = event.logicalKey, down = event is KeyDownEvent;
    if (down && key == LogicalKeyboardKey.escape) { _back(); return true; }
    final sale = _sale;
    if (sale == null) return false;
    final commands = _commands(sale, _lines);
    if (_wide && (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.arrowDown)) {
      _move(key == LogicalKeyboardKey.arrowDown ? 1 : -1, commands);
      return true;
    }
    if (!down) return false;
    if (_wide && (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter || key == LogicalKeyboardKey.space)) {
      final at = _actionNodes.indexWhere((node) => node.hasFocus);
      if (at < 0 || at >= commands.length) return false;
      commands[at].run?.call();
      return true;
    }
    final hit = commands.where((c) => c.key == key).firstOrNull;
    if (hit == null) return false;
    hit.run?.call();
    return true;
  }

  /// One column of stops: the lines top to bottom, then the actions. It does not wrap at either end.
  void _move(int step, List<SaleCommand> commands) {
    final count = _lines.length;
    if (_items.hasFocus) {
      final next = _row + step;
      if (next >= count) { if (commands.isNotEmpty) { _stop = 0; _actionNodes.first.requestFocus(); } }
      else if (next >= 0) { setState(() => _row = next); _reveal(next); }
      return;
    }
    final at = _actionNodes.indexWhere((node) => node.hasFocus);
    final next = (at < 0 ? _stop.clamp(0, commands.length - 1) : at) + step;
    if (next >= commands.length) return;
    if (next >= 0) { _stop = next; _actionNodes[next].requestFocus(); return; }
    if (count > 0) { _row = count - 1; _items.requestFocus(); _reveal(_row); }
  }

  /// Rows are a fixed height, so the offset of a line is its index times the height.
  void _reveal(int row) {
    if (!_scroll.hasClients) return;
    final top = row * _rowHeight, bottom = top + _rowHeight, view = _scroll.position.viewportDimension;
    if (top < _scroll.offset) { _scroll.jumpTo(top); }
    else if (bottom > _scroll.offset + view) { _scroll.jumpTo(bottom - view); }
  }

  num _owed(Map<String, dynamic> sale) {
    if (sale['status'] == 'dibatalkan' || sale['metodePembayaran'] != 'bon') return 0;
    final due = (number(sale['total']) ?? 0) - (number(sale['dibayar']) ?? 0);
    return due > 0 ? due : 0;
  }

  static String _day(Object? value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null ? (value?.toString() ?? '') : dateText(parsed);
  }

  @override Widget build(BuildContext context) {
    final sale = _sale;
    return Shortcuts(shortcuts: _wide ? _taken : const {}, child: _wide ? _wideScreen(sale) : _phoneScreen(sale));
  }

  // ---- wide: one card, the lines on the surface and the nota on the tint, as the payment page ----

  Widget _sectionLabel(String label, {Color? color}) => Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: color ?? KasirColors.label));

  /// The 2px focus ring, drawn outside the control; a [filled] control gets the ink colour so the ring shows against its fill.
  Widget _ring(bool on, Widget child, {bool filled = false}) => Container(
    padding: const EdgeInsets.all(2),
    decoration: BoxDecoration(border: Border.all(color: on ? (filled ? KasirColors.ink : KasirColors.primary) : Colors.transparent, width: 2), borderRadius: BorderRadius.circular(Corners.control + 2)),
    child: child);

  Widget _dashed() => LayoutBuilder(builder: (context, box) => Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    children: List.generate((box.maxWidth / 8).floor(), (_) => Container(width: 4, height: 1, color: KasirColors.gridLine)),
  ));

  /// The focus rings and the highlighted line read the focus nodes, so everything is built inside the listener.
  Widget _wideScreen(Map<String, dynamic>? sale) => Scaffold(backgroundColor: palette.canvas, body: SafeArea(child: AnimatedBuilder(
    animation: Listenable.merge([_items, ..._actionNodes]),
    builder: (context, _) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _topBar(sale),
      _notice(),
      Expanded(child: _wideBody(sale)),
    ]),
  )));

  Widget _wideBody(Map<String, dynamic>? sale) {
    if (sale == null && loading) return const Center(child: CircularProgressIndicator());
    if (sale == null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(error ?? 'Nota belum bisa dimuat.', style: TextStyle(color: errorColor)),
        if (widget.confirmation?['total'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Total tersimpan ${rupiah(widget.confirmation!['total'])}', style: TextStyle(fontWeight: FontWeight.w700, color: KasirColors.ink))),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: load, child: const Text('Muat ulang detail')),
      ]));
    }
    final lines = _lines, commands = _commands(sale, lines);
    return Padding(padding: const EdgeInsets.all(24), child: Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow),
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Expanded(flex: 62, child: _linesPane(lines, commands)),
        Container(width: 1, color: KasirColors.border),
        Expanded(flex: 38, child: _notePane(sale, lines, commands)),
      ]),
    ));
  }

  Widget _topBar(Map<String, dynamic>? sale) {
    final nota = sale?['nomorNota'] ?? sale?['id'] ?? widget.id;
    final kasir = sale?['kasirName']?.toString();
    final meta = [if (sale != null) dateTimeLabel(sale['tanggal'] ?? sale['createdAt']), if (kasir != null && kasir.isNotEmpty) kasir].join(' · ');
    return Container(
      height: 52, padding: const EdgeInsets.symmetric(horizontal: Space.md),
      decoration: BoxDecoration(color: KasirColors.surface, border: Border(bottom: BorderSide(color: KasirColors.border))),
      child: Row(children: [
        TextButton(
          onPressed: _back,
          style: TextButton.styleFrom(foregroundColor: KasirColors.ink),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.arrow_back, size: 18), const SizedBox(width: 6),
            Text(widget.confirmation != null ? 'Kasir' : 'Riwayat', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)), const SizedBox(width: 8), const KasirKey('Esc'),
          ]),
        ),
        const SizedBox(width: Space.md),
        Text('Nota #$nota', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: KasirColors.ink)),
        if (sale != null) ...[const SizedBox(width: Space.sm), _statusPill(sale)],
        Expanded(child: Text(meta, textAlign: TextAlign.end, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: muted))),
        const SizedBox(width: Space.sm),
      ]),
    );
  }

  Widget _statusPill(Map<String, dynamic> sale) {
    if (sale['status'] == 'dibatalkan') return Pill('Dibatalkan', color: errorColor);
    final owed = _owed(sale);
    return owed > 0 ? Pill('Belum lunas · sisa ${rupiah(owed)}', color: warningColor) : Pill('Lunas', color: successColor);
  }

  /// What happened to the receipt of a sale just saved, as one slim row instead of a panel. It keeps its slot in the column when
  /// empty: shifting the body down a slot would rebuild it and drop the focus.
  Widget _notice() {
    if (printed == null) return const SizedBox.shrink();
    final good = printSkipped || printed == true;
    final ink = good ? KasirColors.changeInk : KasirColors.dueInk;
    final message = printSkipped ? 'Penjualan sudah tersimpan tanpa struk. Kalau pembeli minta struk, tekan Cetak ulang.'
      : printed == true ? 'Penjualan sudah tersimpan. Struk tercetak di PC.'
      : 'Penjualan sudah tersimpan, tetapi struk belum tercetak. Jangan membuat penjualan lagi, pakai Cetak ulang.${printError == null ? '' : ' $printError'}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
      decoration: BoxDecoration(color: good ? KasirColors.changeBg : KasirColors.dueBg, border: Border(bottom: BorderSide(color: KasirColors.border))),
      child: Row(children: [
        Icon(good ? Icons.check_circle_outline : Icons.warning_amber_rounded, size: 18, color: ink), const SizedBox(width: 10),
        Expanded(child: Text(message, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: ink))),
      ]),
    );
  }

  Widget _linesPane(List<Map> lines, List<SaleCommand> commands) {
    final payments = detail?['bonPayments'] is List ? (detail!['bonPayments'] as List).whereType<Map>().toList() : <Map>[];
    final edits = detail?['edits'] is List ? (detail!['edits'] as List).whereType<Map>().toList() : <Map>[];
    final qty = lines.fold<num>(0, (sum, line) => sum + (number(line['qty']) ?? 0));
    final highlighted = _items.hasFocus && lines.isNotEmpty ? _row.clamp(0, lines.length - 1) : -1;
    final headStyle = TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.6, color: KasirColors.label);
    return LayoutBuilder(builder: (context, box) {
      final roomy = box.maxWidth >= 700;
      final no = roomy ? 52.0 : 36.0, qtyWidth = roomy ? 80.0 : 56.0, price = roomy ? 112.0 : 88.0, discount = roomy ? 104.0 : 80.0, subtotal = roomy ? 124.0 : 104.0;
      Widget cell(double width, Widget child, {Alignment alignment = Alignment.centerRight}) => SizedBox(width: width, child: Align(alignment: alignment, child: child));
      Widget row(int index, Map line) {
        final on = index == highlighted;
        final unit = (line['namaSatuan'] ?? line['satuan'] ?? '').toString();
        final tag = line['priceSource'] == 'price_tier' ? 'grosir' : line['priceSource'] == 'manual' ? 'manual' : null;
        final off = number(line['diskon']) ?? 0;
        return Container(
          height: _rowHeight, padding: EdgeInsets.only(left: on ? 0 : 3, right: 24),
          decoration: BoxDecoration(color: on ? KasirColors.selectedRow : null, border: Border(
            top: index > 0 ? BorderSide(color: KasirColors.gridLine) : BorderSide.none, left: on ? BorderSide(color: KasirColors.primary, width: 3) : BorderSide.none)),
          child: Row(children: [
            cell(no, Text('${index + 1}', style: TextStyle(fontSize: 13, color: KasirColors.label)), alignment: Alignment.center),
            Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((line['namaItem'] ?? line['productName'] ?? line['namaProduk'] ?? 'Barang #${line['productId'] ?? ''}').toString(), maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: KasirColors.ink)),
              if (unit.isNotEmpty || tag != null) Padding(padding: const EdgeInsets.only(top: 3), child: Row(children: [
                if (unit.isNotEmpty) Text(unit, style: TextStyle(fontSize: 12, color: KasirColors.label)),
                if (unit.isNotEmpty && tag != null) const SizedBox(width: 6),
                if (tag != null) Pill(tag),
              ])),
            ])),
            cell(qtyWidth, Text(quantityText(line['qty']), style: amountStyle.copyWith(fontSize: 14, fontWeight: FontWeight.w600))),
            cell(price, Text(rupiah(line['hargaJual']), style: amountStyle.copyWith(fontSize: 13))),
            cell(discount, off > 0 ? Text('−${rupiah(off)}', style: amountStyle.copyWith(fontSize: 13, color: KasirColors.destructive)) : Text('-', style: TextStyle(color: KasirColors.muted))),
            cell(subtotal, Text(rupiah(line['subtotal'] ?? line['total']), style: moneyStyle.copyWith(fontSize: 14))),
          ]),
        );
      }
      Widget ledger(String title, List<(String, String)> entries) => Container(
        padding: const EdgeInsets.fromLTRB(24, 14, 24, 14),
        decoration: BoxDecoration(border: Border(top: BorderSide(color: KasirColors.border))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _sectionLabel(title), const SizedBox(height: 6),
          for (final (left, right) in entries) Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
            Expanded(child: Text(left, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: KasirColors.label))),
            const SizedBox(width: 12),
            Text(right, style: amountStyle.copyWith(fontSize: 13)),
          ])),
        ]),
      );
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.fromLTRB(24, 18, 24, 12), child: Row(children: [
          _sectionLabel('BARANG', color: KasirColors.primary), const Spacer(),
          Text('${lines.length} barang · ${quantityText(qty)} qty', style: TextStyle(fontSize: 12, color: KasirColors.label)),
        ])),
        Container(
          height: 40, color: KasirColors.accent, padding: const EdgeInsets.only(left: 3, right: 24),
          child: Row(children: [
            cell(no, Text('NO', style: headStyle), alignment: Alignment.center),
            Expanded(child: Text('PRODUK', style: headStyle)),
            cell(qtyWidth, Text('QTY', style: headStyle)), cell(price, Text('HARGA', style: headStyle)),
            cell(discount, Text('DISKON', style: headStyle)), cell(subtotal, Text('SUBTOTAL', style: headStyle)),
          ]),
        ),
        Expanded(child: SingleChildScrollView(controller: _scroll, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Focus(focusNode: _items, child: lines.isEmpty
            ? Padding(padding: const EdgeInsets.all(24), child: Text('Tidak ada barang pada nota ini.', style: TextStyle(fontSize: 14, color: KasirColors.muted)))
            : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final (index, line) in lines.indexed) row(index, line)])),
          if (payments.isNotEmpty) ledger('CICILAN BON', [for (final p in payments) () {
            final note = (p['keterangan'] ?? '').toString().trim();
            final day = _day(p['tanggal'] ?? p['createdAt']);
            return (note.isEmpty ? day : '$day · $note', rupiah(p['jumlah']));
          }()]),
          if (edits.isNotEmpty) ledger('RIWAYAT PERUBAHAN', [for (final e in edits) () {
            final who = (e['kasirName'] ?? '').toString().trim();
            final diff = e['totalSebelum'] != null && e['totalSesudah'] != null ? '${rupiah(e['totalSebelum'])} → ${rupiah(e['totalSesudah'])}' : '';
            return ('${dateTimeLabel(e['createdAt'] ?? e['tanggal'])}${who.isEmpty ? '' : ' · $who'} · ${e['keterangan'] ?? e['reason'] ?? 'Perubahan transaksi'}', diff);
          }()]),
        ]))),
        if (isDesktop) Container(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
          decoration: BoxDecoration(border: Border(top: BorderSide(color: KasirColors.border))),
          child: Wrap(spacing: 20, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            for (final (keys, action) in [('Esc', 'kembali'), ('↑↓', 'pilih'), ('Enter', 'jalankan'), for (final c in commands) if (c.key != null && c.hint != null) (c.key!.keyLabel, c.hint!)])
              Row(mainAxisSize: MainAxisSize.min, children: [KasirKey(keys), const SizedBox(width: 6), Text(action, style: TextStyle(fontSize: 12, color: KasirColors.label))]),
          ]),
        ),
      ]);
    });
  }

  Widget _kv(String label, String value, {bool money = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(label, style: TextStyle(fontSize: 13, color: KasirColors.label)),
    const SizedBox(width: 14),
    Expanded(child: Text(value, textAlign: TextAlign.end, maxLines: 2, overflow: TextOverflow.ellipsis,
      style: money ? amountStyle.copyWith(fontSize: 13, color: KasirColors.ink) : TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: KasirColors.ink))),
  ]));

  Widget _banner(String label, String amount, {required bool good}) => Container(
    height: 48, margin: const EdgeInsets.only(top: 12), padding: const EdgeInsets.symmetric(horizontal: 16),
    decoration: BoxDecoration(color: good ? KasirColors.changeBg : KasirColors.dueBg, borderRadius: BorderRadius.circular(Corners.panel)),
    child: Row(children: [
      Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: good ? KasirColors.changeInk : KasirColors.dueInk)),
      const Spacer(),
      Text(amount, style: moneyStyle.copyWith(fontSize: 20, color: good ? KasirColors.changeInk : KasirColors.dueInk)),
    ]),
  );

  Widget _notePane(Map<String, dynamic> sale, List<Map> lines, List<SaleCommand> commands) {
    final owed = _owed(sale);
    final change = number(sale['kembalian']) ?? 0, discount = number(sale['diskon']) ?? 0, charge = number(sale['biayaLain']) ?? 0, laba = number(sale['laba']);
    final note = sale['keterangan']?.toString().trim() ?? '';
    final items = lines.fold<num>(0, (sum, line) => sum + (number(line['subtotal'] ?? line['total']) ?? 0));
    return ColoredBox(color: KasirColors.tint, child: Padding(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _sectionLabel('INFO NOTA', color: KasirColors.primary), const SizedBox(height: 6),
        _kv('Pelanggan', (sale['namaPelanggan'] ?? 'Umum').toString()),
        _kv('Metode', metodeLabel[sale['metodePembayaran']] ?? text(sale['metodePembayaran'])),
        if (note.isNotEmpty) _kv('Keterangan', note),
        const SizedBox(height: 10), _dashed(), const SizedBox(height: 12),
        _sectionLabel('RINGKASAN'), const SizedBox(height: 6),
        if (lines.isNotEmpty) _kv('Subtotal', rupiah(items), money: true),
        if (discount > 0) _kv('Diskon nota', '−${rupiah(discount)}', money: true),
        if (charge > 0) _kv('Biaya lain', rupiah(charge), money: true),
        if (sale['dibayar'] != null) _kv('Dibayar', rupiah(sale['dibayar']), money: true),
        const SizedBox(height: 10), _dashed(), const SizedBox(height: 12),
        _sectionLabel('TOTAL'), const SizedBox(height: 4),
        Align(alignment: Alignment.centerRight, child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight,
          child: Text(rupiah(sale['total'] ?? widget.confirmation?['total']), style: moneyStyle.copyWith(fontSize: 36, height: 1.15)))),
        if (owed > 0) _banner('Sisa piutang', rupiah(owed), good: false)
        else if (change > 0) _banner('Kembalian', rupiah(change), good: true),
        if (sale['status'] != 'dibatalkan' && sale['modal'] != null && laba != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text.rich(TextSpan(
          style: TextStyle(fontSize: 12, color: KasirColors.label),
          children: [TextSpan(text: 'Modal ${rupiah(sale['modal'])} · laba '), TextSpan(text: rupiah(laba), style: TextStyle(color: profitColor(laba)))]))),
      ]))),
      const SizedBox(height: 12),
      for (final (index, c) in commands.indexed) Padding(padding: EdgeInsets.only(top: index == 0 ? 0 : 2), child: _action(index, c)),
    ])));
  }

  /// A full-width action: icon and label, its letter as a keycap on the right, a ring while it holds focus.
  Widget _action(int index, SaleCommand c) {
    final foreground = c.primary ? KasirColors.onPrimary : c.destructive ? KasirColors.destructive : KasirColors.ink;
    final button = Material(
      color: c.primary ? KasirColors.primary : KasirColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control),
        side: c.primary ? BorderSide.none : BorderSide(color: c.destructive ? KasirColors.destructive.withValues(alpha: 0.5) : KasirColors.border)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(canRequestFocus: false, onTap: c.run == null ? null : () => c.run!(), child: SizedBox(height: c.primary ? 42 : 36, child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12), child: Row(children: [
          Icon(c.icon, size: 18, color: foreground), const SizedBox(width: 10),
          Expanded(child: Text(c.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: foreground))),
          if (isDesktop && c.key != null) KasirKey(c.key!.keyLabel),
        ])))),
    );
    return Focus(focusNode: _actionNodes[index], child: _ring(_actionNodes[index].hasFocus, Opacity(opacity: c.run == null ? 0.45 : 1, child: button), filled: c.primary));
  }

  // ---- phone: the nota stacked ----

  Widget _phoneScreen(Map<String, dynamic>? sale) {
    final lines = _lines;
    final payments = detail?['bonPayments']; final edits = detail?['edits'];
    return Scaffold(appBar: AppBar(title: Text('Nota #${widget.id}')), body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
      if (widget.confirmation != null) ...[Center(child: Icon(Icons.check_circle, size: 64, color: successColor)), const SizedBox(height: 12), const Center(child: Text('Penjualan sudah tersimpan', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600))), const SizedBox(height: Space.lg)],
      if (printed != null) WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(printSkipped ? 'Disimpan tanpa struk' : printed! ? 'Struk tercetak di PC' : 'Penjualan tersimpan, cetak belum berhasil', style: const TextStyle(fontWeight: FontWeight.w700)),
        if (printError != null && !printSkipped) Padding(padding: const EdgeInsets.only(top: 8), child: Text(printError!, style: TextStyle(color: errorColor))),
        if (printSkipped) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Kalau pembeli minta struk, tekan Cetak ulang.'))
        else if (!printed!) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Gunakan cetak ulang. Tidak perlu membuat penjualan lagi.')),
      ])), const SizedBox(height: Space.lg),
      if (loading) const Center(child: CircularProgressIndicator())
      else if (error != null) ...[Text(error!, style: TextStyle(color: errorColor)), OutlinedButton(onPressed: load, child: const Text('Muat ulang detail'))]
      else if (sale != null) WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SummaryRow('Nomor nota', (sale['nomorNota'] ?? sale['id'] ?? widget.id).toString()),
        SummaryRow('Pelanggan', (sale['namaPelanggan'] ?? 'Umum').toString()), SummaryRow('Tanggal', dateTimeLabel(sale['tanggal'] ?? sale['createdAt'])),
        SummaryRow('Metode', metodeLabel[sale['metodePembayaran']] ?? text(sale['metodePembayaran'])),
        if (sale['status'] == 'dibatalkan') SummaryRow('Status', 'Dibatalkan', color: errorColor),
        if (sale['kasirName'] != null) SummaryRow('Kasir', sale['kasirName'].toString()),
        if (sale['keterangan'] != null) SummaryRow('Keterangan', sale['keterangan'].toString()), const Divider(),
        for (final line in lines) Padding(padding: const EdgeInsets.only(bottom: 14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text((line['namaItem'] ?? line['productName'] ?? line['namaProduk'] ?? 'Barang #${line['productId'] ?? ''}').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
          Text('${quantityText(line['qty'])} ${(line['namaSatuan'] ?? line['satuan'] ?? '').toString()} • ${rupiah(line['hargaJual'])}${line['priceSource'] == 'price_tier' ? ' · grosir' : line['priceSource'] == 'manual' ? ' · manual' : ''}${(number(line['diskon']) ?? 0) > 0 ? ' · diskon ${rupiah(line['diskon'])}' : ''}', style: TextStyle(color: muted)),
          if (line['subtotal'] != null || line['total'] != null) SummaryRow('Jumlah', rupiah(line['subtotal'] ?? line['total'])),
        ])), const Divider(),
        if ((number(sale['diskon']) ?? 0) > 0) SummaryRow('Diskon nota', '-${rupiah(sale['diskon'])}'),
        if ((number(sale['biayaLain']) ?? 0) > 0) SummaryRow('Biaya lain', rupiah(sale['biayaLain'])),
        SummaryRow('Total', rupiah(sale['total'] ?? widget.confirmation?['total']), strong: true),
        if (sale['status'] != 'dibatalkan' && sale['modal'] != null) SummaryRow('Modal barang', rupiah(sale['modal'])),
        if (sale['status'] != 'dibatalkan' && sale['laba'] != null) SummaryRow('Laba', rupiah(sale['laba']), color: profitColor(number(sale['laba']))),
        if (sale['dibayar'] != null) SummaryRow('Dibayar', rupiah(sale['dibayar'])),
        if (sale['metodePembayaran'] == 'bon' && (number(sale['total']) ?? 0) > (number(sale['dibayar']) ?? 0))
          SummaryRow('Sisa piutang', rupiah((number(sale['total']) ?? 0) - (number(sale['dibayar']) ?? 0)), color: errorColor),
        if (sale['kembalian'] != null) SummaryRow('Kembalian', rupiah(sale['kembalian'])),
        if (payments is List && payments.isNotEmpty) ...[const Divider(), const Text('Cicilan bon', style: TextStyle(fontWeight: FontWeight.w700)),
          for (final p in payments.whereType<Map>()) () {
            final ket = (p['keterangan'] ?? '').toString().trim();
            final label = (p['tanggal'] ?? p['createdAt'] ?? '').toString();
            return SummaryRow(ket.isEmpty ? label : '$label · $ket', rupiah(p['jumlah']));
          }(),
        ],
        if (edits is List && edits.isNotEmpty) ...[const Divider(), Text('${edits.length} perubahan tercatat di PC'),
          for (final e in edits.whereType<Map>()) () {
            final who = (e['kasirName'] ?? '').toString().trim();
            final diff = e['totalSebelum'] != null && e['totalSesudah'] != null
                ? ' (${rupiah(e['totalSebelum'])} → ${rupiah(e['totalSesudah'])})'
                : '';
            return Text('${dateTimeLabel(e['createdAt'] ?? e['tanggal'])}${who.isEmpty ? '' : ' · $who'} • ${e['keterangan'] ?? e['reason'] ?? 'Perubahan transaksi'}$diff', style: TextStyle(color: muted, fontSize: 13));
          }(),
        ],
      ])),
      if (detail == null && widget.confirmation != null) SummaryRow('Total tersimpan', rupiah(widget.confirmation!['total']), strong: true),
      if (sale != null && widget.api is StoreApi) ...[const SizedBox(height: Space.lg), SaleActions(api: widget.api as StoreApi, sale: sale, isAdmin: widget.isAdmin, onChanged: load,
        onDeleted: () { if (mounted) Navigator.of(context).pop(); })],
      if (widget.onEdit != null && sale?['status'] == 'selesai') ...[const SizedBox(height: Space.md), OutlinedButton.icon(
        icon: const Icon(Icons.edit_note, size: 18), label: const Text('Ubah nota di kasir'), onPressed: _editInTill)],
      const SizedBox(height: Space.xl),
      OutlinedButton.icon(
        onPressed: sale == null ? null : () => _showReceiptPreview(sale, lines),
        icon: const Icon(Icons.receipt_long_outlined, size: 18),
        label: const Text('Pratinjau struk (58 mm / 80 mm)'),
      ),
      const SizedBox(height: Space.sm),
      OutlinedButton.icon(
        onPressed: sale == null ? null : _copyReceiptText,
        icon: const Icon(Icons.share_outlined, size: 18),
        label: const Text('Salin teks struk (Kirim ke WhatsApp)'),
      ),
      const SizedBox(height: Space.sm),
      OutlinedButton.icon(onPressed: printing ? null : printAgain, icon: const Icon(Icons.print_outlined), label: Text(printing ? 'Mengirim ke printer…' : 'Cetak ulang di PC')),
      const SizedBox(height: 12), TextButton(onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst), child: const Text('Kembali ke kasir')),
    ])))));
  }
}
