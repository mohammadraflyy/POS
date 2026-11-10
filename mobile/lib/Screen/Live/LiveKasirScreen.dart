import 'dart:async';
import 'package:flutter/material.dart';
import '../../state/live_store.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../Widgets/product_row.dart';
import '../Pairing/ScanScreen.dart';
import 'LiveItemSheet.dart';
import 'LiveCartPanel.dart';
import 'LivePaymentScreen.dart';
import 'package:flutter/services.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../services/barcode_burst.dart';
import '../../Widgets/keyboard_picker.dart';
class LiveKasirScreen extends StatefulWidget {
  const LiveKasirScreen({super.key, required this.store, this.active = true});
  final LiveStore store;

  /// False while another menu is showing: the workspace keeps the till alive offstage,
  /// and its keyboard keys must not fire from there.
  final bool active;
  @override State<LiveKasirScreen> createState() => _LiveKasirScreenState();
}
class _LiveKasirScreenState extends State<LiveKasirScreen> {
  final search = TextEditingController();
  final searchFocus = FocusNode();

  /// "Jumlah", as on the desktop till: the next product added (clicked or scanned) goes
  /// in at this quantity, then it falls back to 1.
  final qty = TextEditingController(text: '1');
  final qtyFocus = FocusNode();
  final scanner = BarcodeBurst();
  /// PageUp and PageDown hop between Jumlah and the search on the till (handled in
  /// handleKey); a text field must not also treat them as caret moves.
  static const _hopKeys = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.pageUp): DoNothingAndStopPropagationTextIntent(),
    SingleActivator(LogicalKeyboardKey.pageDown): DoNothingAndStopPropagationTextIntent(),
  };
  Timer? timer;
  List<LiveProduct> products = [];
  bool loading = true;
  String? error;
  int page = 1, lastPage = 1, serial = 0, seenCatalogRevision = 0;
  @override void initState() { super.initState(); seenCatalogRevision = widget.store.catalogRevision; widget.store.addListener(watchStock); HardwareKeyboard.instance.addHandler(handleKey); load(); }
  void watchStock() { if (mounted && seenCatalogRevision != widget.store.catalogRevision) { seenCatalogRevision = widget.store.catalogRevision; load(target: page); } }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); widget.store.removeListener(watchStock); timer?.cancel(); search.dispose(); searchFocus.dispose(); qty.dispose(); qtyFocus.dispose(); super.dispose(); }
  /// The quantity typed in Jumlah; a blank or unreadable entry means 1.
  num get enteredQty {
    try { final value = inputQty(qty.text.trim().isEmpty ? '1' : qty.text); return value > 0 ? value : 1; }
    catch (_) { return 1; }
  }

  void addOne(LiveProduct p, {LiveUnit? unit}) {
    final sold = unit ?? p.units.first;
    final isEditingSale = widget.store.editingSaleId != null;
    final currentPrice = sold.price;
    final existingLines = widget.store.items.where((i) => i.product.id == p.id && i.unit.id == sold.id).toList();

    try {
      if (isEditingSale && existingLines.isNotEmpty) {
        final samePriceLine = existingLines.where((i) => (i.manualPrice ?? i.unit.price) == currentPrice).firstOrNull;
        if (samePriceLine != null) {
          widget.store.put(LiveCartItem(
            product: p,
            unit: sold,
            quantity: samePriceLine.quantity + enteredQty,
            manualPrice: samePriceLine.manualPrice,
            discount: samePriceLine.discount,
            priceNote: samePriceLine.priceNote,
          ));
        } else {
          final histLine = existingLines.first;
          final histPrice = histLine.manualPrice ?? histLine.unit.price;
          final newLine = LiveCartItem(
            product: p,
            unit: sold,
            quantity: enteredQty,
            manualPrice: currentPrice,
            priceNote: 'Tambahan baru · harga katalog (${rupiah(currentPrice)})',
          );
          widget.store.put(newLine);
          showNotice(
            context,
            'Harga ${p.name} di katalog (${rupiah(currentPrice)}) berbeda dengan riwayat nota (${rupiah(histPrice)}). Tambahan otomatis dibuat di baris baru.',
            kind: NoticeKind.info,
          );
        }
      } else {
        final old = existingLines.isEmpty ? null : existingLines.first;
        widget.store.put(LiveCartItem(
          product: p,
          unit: sold,
          quantity: (old?.quantity ?? 0) + enteredQty,
          manualPrice: old?.manualPrice,
          discount: old?.discount,
          priceNote: old?.priceNote,
        ));
      }
      qty.value = const TextEditingValue(text: '1', selection: TextSelection.collapsed(offset: 1));
      HapticFeedback.lightImpact();
      SystemSound.play(SystemSoundType.click);
    } catch (e) {
      showError(context, e);
    }
  }
  /// Enter in the search box: a barcode scanner types the code then Enter, so a single
  /// match goes straight into the cart and the box clears for the next scan.
  Future<void> submitSearch() async {
    timer?.cancel();
    await load();
    if (!mounted || products.length != 1 || !widget.store.editable) return;
    addOne(products.single);
    search.clear(); searchFocus.requestFocus();
  }
  /// F3: change the quantity of the line at the top of the cart, as on the desktop till.
  Future<void> editTopLine() async {
    if (widget.store.items.isEmpty || !widget.store.editable) return;
    final top = widget.store.items.first;
    final result = await editLiveItem(context, top.product, existing: top);
    if (result == null || !mounted) return;
    try { widget.store.replace(top, result); } catch (e) { showError(context, e); }
  }

  /// The desktop till's keys, so a cashier moving to this app keeps their habits. Like the
  /// desktop they work anywhere in the window - but only while the till is the screen in
  /// front: not under a dialog or the payment screen, and not while another menu is showing.
  /// Keys that would type or move the caret (End, /) only act when no text field has focus.
  bool handleKey(KeyEvent event) {
    if (event is! KeyDownEvent || !mounted || !widget.active || ModalRoute.of(context)?.isCurrent == false) return false;
    final typing = FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null;
    if (!typing) {
      final scan = scanner.feed(event);
      if (scan.code != null) { scanned(scan.code!); return true; }
    }
    final key = event.logicalKey;
    final alt = HardwareKeyboard.instance.isAltPressed;
    void Function()? action;
    if (key == LogicalKeyboardKey.pageUp) {
      action = () { qtyFocus.requestFocus(); qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length); };
    } else if (key == LogicalKeyboardKey.slash && !typing) {
      action = openPalette;
    } else if (alt && key == LogicalKeyboardKey.keyP) {
      action = pickCustomer;
    } else if (key == LogicalKeyboardKey.f1 || key == LogicalKeyboardKey.f2 || key == LogicalKeyboardKey.pageDown) {
      action = () { searchFocus.requestFocus(); search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length); };
    } else if (key == LogicalKeyboardKey.f4 || key == LogicalKeyboardKey.f12 || (key == LogicalKeyboardKey.end && !typing)) {
      action = pay;
    } else if (key == LogicalKeyboardKey.f3) {
      action = editTopLine;
    } else if (alt && key == LogicalKeyboardKey.keyH) {
      action = () {
        if (widget.store.items.isNotEmpty) {
          widget.store.newQueue();
          showNotice(context, 'Antrean baru dibuka. Transaksi sebelumnya tersimpan di tab.', kind: NoticeKind.info);
        } else if (widget.store.queues.length > 1) {
          final nextIdx = (widget.store.activeQueueIndex + 1) % widget.store.queues.length;
          widget.store.switchQueue(nextIdx);
          showNotice(context, 'Beralih ke ${widget.store.activeQueue.label}.', kind: NoticeKind.info);
        }
      };
    } else if (alt && key == LogicalKeyboardKey.keyT) {
      action = () {
        widget.store.newQueue();
        showNotice(context, 'Antrean baru dibuka.', kind: NoticeKind.info);
      };
    } else if (alt && key == LogicalKeyboardKey.keyK) {
      action = () => confirmClearCart(context, widget.store);
    }
    if (action == null) return false;
    action();
    return true;
  }

  /// A scanner fired while no text field had focus: find that exact code and put it in the
  /// cart, as the desktop till did, or say plainly that the shop does not carry it.
  Future<void> scanned(String code) async {
    if (!widget.store.editable) return;
    search.text = code;
    await load();
    if (!mounted) return;
    final exact = products.where((p) => p.barcode == code).toList();
    final match = exact.length == 1 ? exact.single : products.length == 1 ? products.single : null;
    if (match == null) { showNotice(context, 'Barcode $code tidak ditemukan di katalog.', kind: NoticeKind.warning); return; }
    addOne(match);
    search.clear();
    load();
  }

  /// The desktop's product palette (/): every product in every unit it is sold in, with
  /// price and stock; the pick goes in at the Jumlah typed.
  Future<void> openPalette() async {
    if (!widget.store.editable) return;
    final picked = await showKeyboardPicker<(LiveProduct, LiveUnit)>(context,
      title: 'Cari barang', hint: 'Nama, kode, atau barcode', description: 'Masuk ke keranjang sebanyak ${quantityText(enteredQty)}',
      emptyText: 'Barang tidak ditemukan.',
      load: (q) async {
        final rows = jsonRows(await widget.store.api.catalog(q, 1)).map(LiveProduct.fromJson);
        return [
          for (final p in rows)
            for (final u in p.units)
              () {
                final unitStock = p.stock == null ? null : (u.conversionFactor > 1 ? (p.stock! / u.conversionFactor).floor() : p.stock!);
                return PickerOption((p, u),
                  title: '${p.name} · ${u.name}', subtitle: p.code,
                  trailing: (unitStock ?? 1) <= 0 ? 'Habis' : '${rupiah(u.price)} · stok ${quantityText(unitStock)}',
                  enabled: (unitStock ?? 1) > 0);
              }(),
        ];
      });
    if (picked == null || !mounted) return;
    addOne(picked.$1, unit: picked.$2);
  }

  /// The desktop's customer picker (Alt+P): an existing name or a new one; payment starts with it.
  Future<void> pickCustomer() async {
    final names = await widget.store.api.customers().catchError((Object _) => <String>[]);
    if (!mounted) return;
    final picked = await showKeyboardPicker<String>(context,
      title: 'Pilih pelanggan', hint: 'Cari atau ketik nama pelanggan baru',
      load: (q) async => [
        const PickerOption('', title: 'Umum', subtitle: 'tanpa nama pelanggan'),
        for (final n in names.where((n) => q.isEmpty || n.toLowerCase().contains(q.toLowerCase())).take(30)) PickerOption(n, title: n),
      ],
      extra: (q, results) => q.isEmpty || results.any((o) => o.value.toLowerCase() == q.toLowerCase()) ? null
        : PickerOption(q, title: 'Pelanggan baru: $q', subtitle: 'dicatat saat transaksi disimpan'));
    if (picked != null && mounted) widget.store.setCustomer(picked);
  }

  void pay() {
    if (!widget.store.canCheckout) return;
    openPayment(context, widget.store);
  }
  Future<void> load({int target = 1}) async {
    final request = ++serial; setState(() { loading = true; error = null; });
    try {
      final data = await widget.store.api.catalog(search.text.trim(), target);
      final rows = jsonRows(data).map(LiveProduct.fromJson).toList();
      if (!mounted || request != serial) return;
      setState(() { products = rows; page = (number(data['currentPage']) ?? target).toInt(); lastPage = (number(data['lastPage']) ?? target).toInt(); });
    } catch (e) { if (mounted && request == serial) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }
  Future<void> configure(LiveProduct p) async {
    final item = await editLiveItem(context, p);
    if (!mounted || item == null) return;
    try { widget.store.put(item); } catch (e) { showError(context, e); }
  }
  Future<void> scan() async {
    final value = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (!mounted || value == null) return;
    search.text = value; await load();
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard]), builder: (context, _) => LayoutBuilder(builder: (context, box) {
    final wide = usesSplitCart(context, box);
    final searchRow = Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark ? raised : const Color(0xFFF8FAFC),
        border: Border.all(color: lineColor),
        borderRadius: BorderRadius.circular(Corners.control),
      ),
      child: Row(children: [
        SizedBox(width: 88, child: TextField(controller: qty, focusNode: qtyFocus, textAlign: TextAlign.end,
          keyboardType: const TextInputType.numberWithOptions(decimal: true), textInputAction: TextInputAction.next,
          style: amountStyle.copyWith(fontSize: 16),
          // Enter in Jumlah goes on to the search, ready for the scan or the name
          onSubmitted: (_) { searchFocus.requestFocus(); search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length); },
          onTap: () => qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length),
          decoration: const InputDecoration(prefixText: '× ', hintText: '1', helperText: null, labelText: 'Jumlah'))),
        const SizedBox(width: Space.sm),
        Expanded(child: TextField(controller: search, textInputAction: TextInputAction.search, onChanged: (_) {
          serial++; timer?.cancel(); setState(() { loading = true; error = null; });
          timer = Timer(const Duration(milliseconds: 350), () => load());
        }, focusNode: searchFocus, autofocus: isDesktop, onSubmitted: (_) => submitSearch(),
          decoration: InputDecoration(hintText: isDesktop ? 'Cari nama, kode, atau scan barcode' : 'Cari barang', prefixIcon: const Icon(Icons.search, size: 20)))),
        const SizedBox(width: Space.xs),
        IconButton.filled(
          onPressed: scan,
          tooltip: 'Scan barcode',
          icon: const Icon(Icons.qr_code_scanner, size: 20),
          style: IconButton.styleFrom(
            backgroundColor: primaryInk,
            foregroundColor: onPrimary,
            minimumSize: const Size(40, 40),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
          ),
        ),
        const SizedBox(width: Space.xs),
        IconButton(onPressed: () => load(target: page), tooltip: 'Muat ulang katalog', icon: const Icon(Icons.refresh, size: 20)),
      ]),
    );
    final keys = isDesktop && wide ? Padding(padding: EdgeInsets.only(top: Space.sm), child: Text('PageUp jumlah · PageDown cari · / palet barang · Alt+P pelanggan · End bayar · F3 ubah baris atas · Alt+H tahan/ganti antrean · Alt+T antrean baru · Alt+K kosongkan',
      style: TextStyle(color: muted, fontSize: 12))) : const SizedBox.shrink();
    final queueTabs = widget.store.queues.length > 1 ? Container(
      padding: const EdgeInsets.fromLTRB(Space.lg, Space.xs, Space.sm, Space.xs),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (var i = 0; i < widget.store.queues.length; i++) ...[
              ActionChip(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 4),
                backgroundColor: i == widget.store.activeQueueIndex ? primaryInk : surface,
                side: BorderSide(color: i == widget.store.activeQueueIndex ? primaryInk : lineColor),
                label: Text(
                  widget.store.queues[i].label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: i == widget.store.activeQueueIndex ? FontWeight.w600 : FontWeight.normal,
                    color: i == widget.store.activeQueueIndex ? onPrimary : ink,
                  ),
                ),
                onPressed: () => widget.store.switchQueue(i),
              ),
              const SizedBox(width: 6),
            ],
            IconButton(
              tooltip: 'Tambah antrean baru (Alt+T)',
              icon: const Icon(Icons.add, size: 18),
              style: IconButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.all(4),
                minimumSize: const Size(28, 28),
              ),
              onPressed: widget.store.editable ? () => widget.store.newQueue() : null,
            ),
          ],
        ),
      ),
    ) : null;
    final list = CustomScrollView(slivers: [
      if (loading) const SliverToBoxAdapter(child: LinearProgressIndicator(minHeight: 2)),
      if (error != null) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(Space.lg), child: EmptyPanel(icon: Icons.wifi_off, title: 'Katalog belum dimuat', message: error!, action: OutlinedButton(onPressed: () => load(), child: const Text('Coba lagi')))))
      else if (products.isEmpty && !loading) SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(Space.lg), child: Text('Tidak ada barang yang cocok. Coba kata lain atau scan barcodenya.', style: TextStyle(color: muted))))
      else SliverList(delegate: SliverChildBuilderDelegate((context, index) {
        final p = products[index];
        return ProductRow(name: p.name, code: p.code, stock: quantityText(p.stock),
          price: rupiah(p.units.first.price), unit: p.units.first.name,
          inCart: widget.store.items.any((item) => item.product.id == p.id),
          onConfigure: !loading && widget.store.editable ? () => configure(p) : null,
          onAdd: loading || !widget.store.editable ? null : () => addOne(p));
      }, childCount: products.length)),
      if (lastPage > 1) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md), child: Row(children: [
        Text('Halaman $page dari $lastPage', style: TextStyle(color: muted, fontSize: 13)),
        const Spacer(),
        OutlinedButton(onPressed: !loading && page > 1 ? () => load(target: page - 1) : null, child: const Text('Sebelumnya')),
        const SizedBox(width: Space.sm), OutlinedButton(onPressed: !loading && page < lastPage ? () => load(target: page + 1) : null, child: const Text('Berikutnya')),
      ]))),
    ]);
    final editing = widget.store.editingSaleId;
    final editBanner = editing == null ? null : Container(
      padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.sm, Space.sm),
      decoration: BoxDecoration(color: pillWarningBg, border: Border.all(color: noticeBorder), borderRadius: BorderRadius.circular(Corners.panel)),
      child: Row(children: [
        Icon(Icons.edit_note, size: 18, color: pillWarningInk), const SizedBox(width: Space.sm),
        Expanded(child: Text('Mengubah nota #$editing. Ubah barang di sini, lalu Bayar untuk menyimpan perubahan.', style: TextStyle(color: pillWarningInk, fontSize: 13))),
        TextButton(onPressed: widget.store.editable ? widget.store.cancelEdit : null, child: const Text('Batal ubah')),
      ]));
    if (!wide) {
      return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: Column(children: [
        if (editBanner != null) Padding(padding: const EdgeInsets.fromLTRB(Space.md, Space.md, Space.md, 0), child: editBanner),
        if (queueTabs != null) queueTabs,
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.sm, Space.md), child: searchRow),
        const Divider(),
        Expanded(child: ColoredBox(color: surface, child: list)),
        CartAction(count: widget.store.items.length,
          total: widget.store.pricing ? 'Menghitung…' : rupiah(widget.store.price?.total ?? 0),
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => Scaffold(
            appBar: AppBar(title: const Text('Keranjang')), body: SafeArea(child: Padding(padding: const EdgeInsets.all(Space.md), child: LiveCartPanel(store: widget.store))))))),
      ])));
    }
    // the catalog and the cart are two cards on one frame, so their edges line up
    final catalog = Container(
      decoration: BoxDecoration(color: surface, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel)),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.md, Space.md), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (editBanner != null) ...[editBanner, const SizedBox(height: Space.md)],
          if (queueTabs != null) ...[queueTabs, const SizedBox(height: Space.sm)],
          searchRow, keys])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).brightness == Brightness.dark ? raised.withValues(alpha: 0.5) : const Color(0xFFF8FAFC),
            border: Border(top: BorderSide(color: ruleColor), bottom: BorderSide(color: ruleColor)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Daftar Produk (Katalog Aktif)', style: TextStyle(color: muted, fontSize: 12, fontWeight: FontWeight.w600)),
              Text('${products.length} barang ditampilkan', style: TextStyle(color: muted, fontSize: 12)),
            ],
          ),
        ),
        Expanded(child: list),
      ]));
    // the till is driven from the keyboard on a PC - see handleKey
    final cartWidth = box.maxWidth >= 1400 ? 420.0 : box.maxWidth >= 1200 ? 400.0 : 380.0;
    return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: Padding(padding: const EdgeInsets.all(Space.xl), child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: catalog), const SizedBox(width: Space.gap), SizedBox(width: cartWidth, child: LiveCartPanel(store: widget.store)),
    ]))));
  }));
}
