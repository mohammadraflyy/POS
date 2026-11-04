import 'package:flutter/material.dart';
import '../state/app_state.dart';
import '../core/theme.dart';
import '../Widgets/BottomNavBar.dart';
import '../Widgets/ui.dart';
import 'Penjualan/KasirScreen.dart';
import 'Penjualan/RiwayatPenjualanScreen.dart';
import 'Pembelian/PembelianScreen.dart';
import 'StockOpname/StockOpnameScreen.dart';
import 'Live/LiveWorkspace.dart';
import 'menus.dart';
class MainScreen extends StatefulWidget {
  const MainScreen({super.key, required this.app});
  final AppState app;
  @override
  State<MainScreen> createState() => _MainScreenState();
}
class _MainScreenState extends State<MainScreen> {
  Menu _menu = Menu.kasir;
  void _open(Menu menu) => setState(() => _menu = menu);
  Future<void> _account() async {
    await showModalBottomSheet<void>(context: context, showDragHandle: true, builder: (context) => SafeArea(child: Padding(
      padding: const EdgeInsets.all(Space.xl), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(widget.app.userName, style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: 8),
        Text(widget.app.isDemo ? 'Sesi demo • data hanya di memori' : '${widget.app.address}\n${widget.app.role}'),
        const SizedBox(height: Space.lg),
        if (!widget.app.isDemo) OutlinedButton.icon(onPressed: () { Navigator.pop(context); widget.app.checkConnection(); }, icon: const Icon(Icons.sync), label: const Text('Periksa koneksi')),
        const SizedBox(height: 8), FilledButton.icon(onPressed: () { Navigator.pop(context); widget.app.logout(); }, icon: const Icon(Icons.logout), label: Text(widget.app.isDemo ? 'Keluar dari demo' : 'Keluar')),
        if (!widget.app.isDemo) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Untuk mencabut akses perangkat di server, gunakan menu Pengaturan.', style: TextStyle(color: muted, fontSize: 13))),
      ]),
    )));
  }
  /// Everything beyond the four bottom-bar screens, on a phone.
  Future<void> _more(List<Menu> menus) async {
    final picked = await showModalBottomSheet<Menu>(context: context, showDragHandle: true, isScrollControlled: true, builder: (context) => SafeArea(child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.lg), child: Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
        for (final menu in menus.where((m) => !primaryMenus.contains(m))) SizedBox(width: 108, child: InkWell(
          borderRadius: BorderRadius.circular(Corners.panel), onTap: () => Navigator.pop(context, menu),
          child: Padding(padding: const EdgeInsets.symmetric(vertical: Space.md), child: Column(children: [
            Icon(menuInfo[menu]!.icon, color: menu == _menu ? wine : ink), const SizedBox(height: Space.xs),
            Text(menuInfo[menu]!.title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13)),
          ])))),
      ]))));
    if (picked != null) _open(picked);
  }
  Widget _sidebar(List<Menu> menus) {
    final groups = <String, List<Menu>>{};
    for (final menu in menus) { (groups[menuInfo[menu]!.group] ??= []).add(menu); }
    // Material, not a coloured box: the tiles paint their selection highlight onto it
    return SizedBox(width: 232, child: Material(color: surface, child: ListView(padding: const EdgeInsets.symmetric(vertical: Space.md), children: [
      for (final group in groups.entries) ...[
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.lg, Space.xs),
          child: Text(group.key.toUpperCase(), style: const TextStyle(color: muted, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: .6))),
        for (final menu in group.value) Padding(padding: const EdgeInsets.symmetric(horizontal: Space.sm), child: ListTile(
          dense: true, selected: menu == _menu, selectedTileColor: accentSurface, selectedColor: wine,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
          leading: Icon(menuInfo[menu]!.icon, size: 20), title: Text(menuInfo[menu]!.title),
          onTap: () => _open(menu))),
      ],
    ])));
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
    ]) : LiveWorkspace(app: widget.app, menu: _menu, menus: menus);
    final hasMore = menus.length > primaryMenus.length;
    final barIndex = primaryMenus.contains(_menu) ? primaryMenus.indexOf(_menu) : primaryMenus.length;
    return Scaffold(
      appBar: AppBar(title: Text(menuInfo[_menu]!.title), actions: [
        TextButton.icon(onPressed: _account,
          icon: Icon(widget.app.isDemo ? Icons.science_outlined : widget.app.notice != null ? Icons.wifi_off : Icons.lan_outlined, size: 18),
          label: Text(widget.app.isDemo ? 'Demo' : widget.app.notice != null ? 'Periksa koneksi' : widget.app.userName)),
        IconButton(onPressed: _account, tooltip: 'Perangkat & akun', icon: const Icon(Icons.account_circle_outlined)),
        const SizedBox(width: Space.xs),
      ]),
      body: SafeArea(top: false, child: Column(children: [
        if (widget.app.isDemo) Container(width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.sm),
          decoration: const BoxDecoration(color: surface, border: Border(bottom: BorderSide(color: lineColor))),
          child: const Text('Mode demo / Data contoh, tidak dikirim ke toko', style: TextStyle(fontSize: 13, color: muted))),
        Expanded(child: Row(children: [
          if (wide) ...[
            widget.app.isDemo
              ? NavigationRail(selectedIndex: demoIndex, labelType: NavigationRailLabelType.all,
                  backgroundColor: surface, indicatorColor: accentSurface,
                  onDestinationSelected: (value) => _open(primaryMenus[value]),
                  destinations: [for (final menu in primaryMenus) NavigationRailDestination(icon: Icon(menuInfo[menu]!.icon), label: Text(menuInfo[menu]!.title))])
              : _sidebar(menus),
            const VerticalDivider(width: 1),
          ],
          Expanded(child: workspace),
        ])),
      ])),
      bottomNavigationBar: wide ? null : BottomNavBar(
        selectedIndex: barIndex,
        labels: [for (final menu in primaryMenus) menuInfo[menu]!.title, if (hasMore) 'Lainnya'],
        icons: [for (final menu in primaryMenus) menuInfo[menu]!.icon, if (hasMore) Icons.apps],
        onDestinationSelected: (value) => value < primaryMenus.length ? _open(primaryMenus[value]) : _more(menus)),
    );
  }));
}
