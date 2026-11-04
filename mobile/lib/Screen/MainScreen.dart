import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../state/app_state.dart';
import '../core/theme.dart';
import '../models/live_models.dart';
import '../Widgets/BottomNavBar.dart';
import '../Widgets/ui.dart';
import 'Penjualan/KasirScreen.dart';
import 'Penjualan/RiwayatPenjualanScreen.dart';
import 'Pembelian/PembelianScreen.dart';
import 'StockOpname/StockOpnameScreen.dart';
import 'Live/LiveWorkspace.dart';
import 'menus.dart';

/// The shell. On a PC: an open plane - a labelled sidebar on the stone ground with the
/// shop's mark and name at the top and the account at the bottom, no top bar, the screen
/// sitting straight on the ground. Ctrl+B folds the sidebar to an icon rail, as on the
/// desktop app. On a phone: a 48px bar with the screen's name and a bottom bar.
class MainScreen extends StatefulWidget {
  const MainScreen({super.key, required this.app, this.initialMenu = Menu.kasir});
  final AppState app;

  /// The screen to open on; the till unless a caller (the screen gallery) asks otherwise.
  final Menu initialMenu;
  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  late Menu _menu = widget.initialMenu;
  bool _railOnly = false;
  String? _shopName;

  @override
  void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(_handleKey);
    _loadShopName();
  }

  @override
  void dispose() { HardwareKeyboard.instance.removeHandler(_handleKey); super.dispose(); }

  /// The shop's own name heads the sidebar, so the screen belongs to this shop.
  Future<void> _loadShopName() async {
    if (widget.app.isDemo) return;
    try {
      final settings = jsonObject(await widget.app.businessRequest('/v1/settings', method: 'GET'));
      if (mounted) setState(() => _shopName = settings['namaToko']?.toString());
    } catch (_) {
      // the shell still works without it; the product name stands in
    }
  }

  bool _handleKey(KeyEvent event) {
    if (event is! KeyDownEvent || !mounted || ModalRoute.of(context)?.isCurrent == false) return false;
    if (event.logicalKey == LogicalKeyboardKey.keyB && HardwareKeyboard.instance.isControlPressed) {
      setState(() => _railOnly = !_railOnly);
      return true;
    }
    return false;
  }

  void _open(Menu menu) => setState(() => _menu = menu);

  Future<void> _account() async {
    await showModalBottomSheet<void>(context: context, showDragHandle: true, builder: (context) => SafeArea(child: Padding(
      padding: const EdgeInsets.fromLTRB(Space.xl, 0, Space.xl, Space.xl), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(widget.app.userName, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 4),
        Text(widget.app.isDemo ? 'Sesi demo · data hanya di memori' : '${_roleLabel(widget.app.role)} · ${widget.app.address?.authority ?? ''}', style: const TextStyle(color: muted)),
        const SizedBox(height: Space.lg),
        Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
          if (!widget.app.isDemo) OutlinedButton.icon(onPressed: () { Navigator.pop(context); widget.app.checkConnection(); }, icon: const Icon(Icons.sync, size: 18), label: const Text('Periksa koneksi')),
          OutlinedButton.icon(onPressed: () { Navigator.pop(context); widget.app.logout(); }, icon: const Icon(Icons.logout, size: 18), label: Text(widget.app.isDemo ? 'Keluar dari demo' : 'Keluar')),
        ]),
        if (!widget.app.isDemo) const Padding(padding: EdgeInsets.only(top: Space.md), child: Text('Untuk mencabut akses perangkat, buka Pengaturan.', style: TextStyle(color: muted, fontSize: 12))),
      ]),
    )));
  }

  static String _roleLabel(String role) => role == 'admin' ? 'Admin' : role == 'kasir' ? 'Kasir' : role;

  /// Everything beyond the four bottom-bar screens, on a phone: a plain list, grouped.
  Future<void> _more(List<Menu> menus) async {
    final picked = await showModalBottomSheet<Menu>(context: context, showDragHandle: true, isScrollControlled: true, builder: (context) => SafeArea(child: ListView(
      shrinkWrap: true, padding: const EdgeInsets.fromLTRB(Space.sm, 0, Space.sm, Space.lg), children: [
        for (final menu in menus.where((m) => !primaryMenus.contains(m))) ListTile(
          leading: Icon(menuInfo[menu]!.icon, size: 20), title: Text(menuInfo[menu]!.title),
          selected: menu == _menu, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
          onTap: () => Navigator.pop(context, menu)),
      ])));
    if (picked != null) _open(picked);
  }

  Widget _brand({required bool compact}) => Padding(
    padding: EdgeInsets.fromLTRB(compact ? 0 : Space.lg, Space.lg, compact ? 0 : Space.md, Space.lg),
    child: Row(mainAxisAlignment: compact ? MainAxisAlignment.center : MainAxisAlignment.start, children: [
      const BrandMark(size: 26),
      if (!compact) ...[
        const SizedBox(width: Space.md),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_shopName ?? 'Point of Sales', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, height: 1.3)),
          Text(widget.app.isDemo ? 'Mode demo' : 'Point of Sales', style: const TextStyle(fontSize: 12, color: muted)),
        ])),
      ],
    ]),
  );

  Widget _navRow(Menu menu, {required bool compact}) {
    final selected = menu == _menu;
    final info = menuInfo[menu]!;
    final row = Material(
      color: selected ? activePill : Colors.transparent,
      borderRadius: BorderRadius.circular(Corners.control),
      child: InkWell(
        borderRadius: BorderRadius.circular(Corners.control),
        onTap: () => _open(menu),
        child: SizedBox(height: 32, child: Row(mainAxisAlignment: compact ? MainAxisAlignment.center : MainAxisAlignment.start, children: [
          if (!compact) const SizedBox(width: 10),
          Icon(info.icon, size: 17, color: selected ? ink : muted),
          if (!compact) ...[
            const SizedBox(width: 10),
            Expanded(child: Text(info.title, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 14, color: selected ? ink : const Color(0xFF3D3D3D), fontWeight: selected ? FontWeight.w500 : FontWeight.w400))),
          ],
        ])),
      ),
    );
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: compact ? 8 : Space.sm, vertical: 1),
      child: Semantics(selected: selected, button: true, label: info.title,
        child: compact ? Tooltip(message: info.title, waitDuration: const Duration(milliseconds: 300), child: row) : row),
    );
  }

  Widget _sidebar(List<Menu> menus) {
    final compact = _railOnly;
    final groups = <String, List<Menu>>{};
    for (final menu in menus) { (groups[menuInfo[menu]!.group] ??= []).add(menu); }
    final offline = widget.app.notice != null;
    return SizedBox(width: compact ? 56 : 240, child: Column(children: [
      _brand(compact: compact),
      Expanded(child: ListView(padding: const EdgeInsets.only(bottom: Space.md), children: [
        for (final (index, group) in groups.entries.indexed) ...[
          if (compact)
            Padding(padding: EdgeInsets.symmetric(horizontal: 16, vertical: index == 0 ? 0 : 10), child: index == 0 ? const SizedBox() : const Divider())
          else
            Padding(padding: EdgeInsets.fromLTRB(18, index == 0 ? 0 : 20, Space.md, 6),
              child: Text(group.key, style: const TextStyle(color: muted, fontSize: 12))),
          for (final menu in group.value) _navRow(menu, compact: compact),
        ],
      ])),
      const Divider(indent: 12, endIndent: 12),
      Padding(padding: const EdgeInsets.all(Space.sm), child: Material(color: Colors.transparent, child: InkWell(
        borderRadius: BorderRadius.circular(Corners.control), onTap: _account,
        child: Padding(padding: EdgeInsets.symmetric(horizontal: compact ? 0 : 10, vertical: 8), child: Row(
          mainAxisAlignment: compact ? MainAxisAlignment.center : MainAxisAlignment.start, children: [
          _Initial(widget.app.userName),
          if (!compact) ...[
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(widget.app.userName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
              Row(children: [
                Container(width: 6, height: 6, decoration: BoxDecoration(shape: BoxShape.circle, color: widget.app.isDemo ? muted : offline ? errorColor : successColor)),
                const SizedBox(width: 6),
                Flexible(child: Text(widget.app.isDemo ? 'Demo' : offline ? 'Server tidak terjangkau' : '${_roleLabel(widget.app.role)} · terhubung',
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: muted))),
              ]),
            ])),
            const Icon(Icons.unfold_more, size: 16, color: muted),
          ],
        ])),
      ))),
    ]));
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: widget.app, builder: (context, _) => LayoutBuilder(builder: (context, box) {
    final menus = menusFor(widget.app);
    if (!menus.contains(_menu)) _menu = Menu.kasir;
    final wide = box.maxWidth >= 1100 && box.maxHeight >= 600 && MediaQuery.textScalerOf(context).scale(14) < 22;
    final demoIndex = primaryMenus.indexOf(_menu).clamp(0, 3);
    final workspace = widget.app.isDemo ? IndexedStack(index: demoIndex, children: [
      KasirScreen(app: widget.app), WorkArea(child: PembelianScreen(app: widget.app)),
      WorkArea(child: StockOpnameScreen(app: widget.app)), WorkArea(child: RiwayatPenjualanScreen(app: widget.app)),
    ]) : LiveWorkspace(app: widget.app, menu: _menu, menus: menus, onOpenMenu: _open);
    final hasMore = menus.length > primaryMenus.length;
    final barIndex = primaryMenus.contains(_menu) ? primaryMenus.indexOf(_menu) : primaryMenus.length;
    final demoBanner = widget.app.isDemo ? Container(width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: 6),
      decoration: const BoxDecoration(color: pillWarningBg, border: Border(bottom: BorderSide(color: Color(0xFFFDE68A)))),
      child: const Text('Mode demo · data contoh, tidak dikirim ke toko', style: TextStyle(fontSize: 12, color: pillWarningInk))) : null;

    if (wide) {
      return Scaffold(body: SafeArea(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _sidebar(widget.app.isDemo ? primaryMenus : menus),
        const VerticalDivider(width: 1),
        Expanded(child: Column(children: [if (demoBanner != null) demoBanner, Expanded(child: workspace)])),
      ])));
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(menuInfo[_menu]!.title),
        actions: [
          IconButton(onPressed: _account, tooltip: 'Akun & koneksi',
            icon: widget.app.notice != null ? const Icon(Icons.wifi_off, color: errorColor) : _Initial(widget.app.userName)),
          const SizedBox(width: Space.xs),
        ]),
      body: SafeArea(top: false, child: Column(children: [if (demoBanner != null) demoBanner, Expanded(child: workspace)])),
      bottomNavigationBar: BottomNavBar(
        selectedIndex: barIndex,
        labels: [for (final menu in primaryMenus) menuInfo[menu]!.title, if (hasMore) 'Lainnya'],
        icons: [for (final menu in primaryMenus) menuInfo[menu]!.icon, if (hasMore) Icons.menu],
        onDestinationSelected: (value) => value < primaryMenus.length ? _open(primaryMenus[value]) : _more(menus)),
    );
  }));
}

/// A person as a stable initial on a pale neutral disc.
class _Initial extends StatelessWidget {
  const _Initial(this.name);
  final String name;
  @override
  Widget build(BuildContext context) => Container(
    width: 28, height: 28, alignment: Alignment.center,
    decoration: const BoxDecoration(color: activePill, shape: BoxShape.circle),
    child: Text(name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: ink)),
  );
}
