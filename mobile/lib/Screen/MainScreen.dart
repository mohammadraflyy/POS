import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'AccountPanel.dart';
import '../services/updater_service.dart';

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
  AppUpdateInfo? _availableUpdate;
  bool _dismissedUpdate = false;
  Timer? _updateCheckTimer;
  final Map<Menu, FocusNode> _menuFocusNodes = {};

  FocusNode _nodeFor(Menu menu) => _menuFocusNodes.putIfAbsent(menu, () => FocusNode(debugLabel: 'menu_${menu.name}'));

  @override
  void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(_handleKey);
    _loadShopName();
    _checkUpdateNotice();
    // Cek pembaruan berkala setiap 30 menit jika aplikasi desktop/mobile terus menyala
    _updateCheckTimer = Timer.periodic(const Duration(minutes: 30), (_) {
      if (mounted && _availableUpdate == null) {
        _checkUpdateNotice();
      }
    });
  }

  @override
  void dispose() {
    _updateCheckTimer?.cancel();
    HardwareKeyboard.instance.removeHandler(_handleKey);
    for (final node in _menuFocusNodes.values) {
      node.dispose();
    }
    super.dispose();
  }

  Future<void> _checkUpdateNotice() async {
    try {
      final info = await UpdaterService().checkForUpdate();
      if (mounted && info != null && info.isNewer) {
        setState(() => _availableUpdate = info);
      }
    } catch (_) {}
  }

  Widget? _updateBanner() {
    if (_availableUpdate == null || _dismissedUpdate) return null;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF1E3A8A),
        border: Border(bottom: BorderSide(color: Colors.blue.shade300.withValues(alpha: 0.3))),
      ),
      child: Row(children: [
        const Icon(Icons.system_update_outlined, color: Colors.white, size: 18),
        const SizedBox(width: Space.md),
        Expanded(
          child: Text(
            'Pembaruan v${_availableUpdate!.latestVersion} tersedia!',
            style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
          ),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: const Color(0xFF1E3A8A),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            minimumSize: Size.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          onPressed: () => promptAppUpdate(context),
          child: const Text('Perbarui Sekarang', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
        ),
        const SizedBox(width: 8),
        IconButton(
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(),
          icon: const Icon(Icons.close, color: Colors.white70, size: 18),
          tooltip: 'Tutup notifikasi',
          onPressed: () => setState(() => _dismissedUpdate = true),
        ),
      ]),
    );
  }

  /// The shop's own name heads the sidebar, so the screen belongs to this shop.
  Future<void> _loadShopName() async {
    if (widget.app.isDemo) return;
    try {
      await widget.app.refreshBranding();
      if (mounted) setState(() => _shopName = widget.app.shopName);
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
    final isAlt = HardwareKeyboard.instance.isAltPressed;
    final isCtrl = HardwareKeyboard.instance.isControlPressed;
    // Alt+M or Ctrl+M focuses active menu in sidebar
    if ((isAlt || isCtrl) && event.logicalKey == LogicalKeyboardKey.keyM) {
      _nodeFor(_menu).requestFocus();
      return true;
    }
    // Alt+1 .. Alt+9 direct menu shortcuts
    if (isAlt) {
      final numKey = event.logicalKey;
      final digit = numKey == LogicalKeyboardKey.digit1 ? 1
          : numKey == LogicalKeyboardKey.digit2 ? 2
          : numKey == LogicalKeyboardKey.digit3 ? 3
          : numKey == LogicalKeyboardKey.digit4 ? 4
          : numKey == LogicalKeyboardKey.digit5 ? 5
          : numKey == LogicalKeyboardKey.digit6 ? 6
          : numKey == LogicalKeyboardKey.digit7 ? 7
          : numKey == LogicalKeyboardKey.digit8 ? 8
          : numKey == LogicalKeyboardKey.digit9 ? 9
          : null;
      if (digit != null) {
        final menus = widget.app.isDemo ? primaryMenus : menusFor(widget.app);
        if (digit - 1 < menus.length) {
          final target = menus[digit - 1];
          _nodeFor(target).requestFocus();
          _open(target);
          return true;
        }
      }
    }
    return false;
  }

  void _open(Menu menu) {
    setState(() => _menu = menu);
  }

  Future<void> _account() => showAccountPanel(context, app: widget.app, shopName: _shopName,
    onOpenSettings: menusFor(widget.app).contains(Menu.pengaturan) ? () => _open(Menu.pengaturan) : null);

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
    padding: EdgeInsets.fromLTRB(compact ? 0 : Space.lg, Space.xl, compact ? 0 : Space.md, Space.lg),
    child: Row(mainAxisAlignment: compact ? MainAxisAlignment.center : MainAxisAlignment.start, children: [
      BrandMark(size: 28, logo: widget.app.shopLogo),
      if (!compact) ...[
        const SizedBox(width: Space.md),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.app.shopName ?? _shopName ?? 'Point of Sales', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, height: 1.25)),
          const SizedBox(height: 2),
          Text(widget.app.isDemo ? 'Mode demo' : 'Point of Sales', style: TextStyle(fontSize: 12, color: muted)),
        ])),
      ],
    ]),
  );

  Widget _navRow(Menu menu, {required bool compact, required List<Menu> allMenus}) {
    final selected = menu == _menu;
    final info = menuInfo[menu]!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final focusNode = _nodeFor(menu);

    // High-contrast active state (WCAG AAA):
    // Light mode: solid dark slate-900 pill with pure white text and icon.
    // Dark mode: elevated slate-800 pill with sky-blue border, sky-blue icon, and pure white text.
    final activeBg = isDark ? const Color(0xFF1E293B) : const Color(0xFF0F172A);
    final activeFg = Colors.white;
    final activeIconColor = isDark ? const Color(0xFF38BDF8) : Colors.white;

    final row = Focus(
      focusNode: focusNode,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        final key = event.logicalKey;
        final idx = allMenus.indexOf(menu);
        if (key == LogicalKeyboardKey.arrowDown) {
          if (idx >= 0 && idx < allMenus.length - 1) {
            final next = allMenus[idx + 1];
            _nodeFor(next).requestFocus();
            _open(next);
            return KeyEventResult.handled;
          }
        } else if (key == LogicalKeyboardKey.arrowUp) {
          if (idx > 0) {
            final prev = allMenus[idx - 1];
            _nodeFor(prev).requestFocus();
            _open(prev);
            return KeyEventResult.handled;
          }
        } else if (key == LogicalKeyboardKey.arrowRight) {
          node.nextFocus();
          return KeyEventResult.handled;
        } else if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space) {
          _open(menu);
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: Builder(builder: (context) {
        final hasFocus = Focus.of(context).hasFocus;
        final isHighlighted = selected || hasFocus;
        return Material(
          color: selected
              ? activeBg
              : (hasFocus ? (isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0)) : Colors.transparent),
          borderRadius: BorderRadius.circular(Corners.control),
          elevation: selected ? 1.5 : 0,
          child: Container(
            decoration: BoxDecoration(
              border: Border.all(
                color: hasFocus
                    ? (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0284C7))
                    : (selected && isDark ? const Color(0xFF38BDF8) : Colors.transparent),
                width: hasFocus ? 2.0 : (selected && isDark ? 1.5 : 1.0),
              ),
              borderRadius: BorderRadius.circular(Corners.control),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(Corners.control),
              onTap: () {
                focusNode.requestFocus();
                _open(menu);
              },
              child: SizedBox(
                height: 40,
                child: Row(
                  mainAxisAlignment: compact ? MainAxisAlignment.center : MainAxisAlignment.start,
                  children: [
                    if (!compact) const SizedBox(width: 12),
                    Icon(
                      info.icon,
                      size: 20,
                      color: selected
                          ? activeIconColor
                          : (hasFocus ? (isDark ? Colors.white : const Color(0xFF0F172A)) : (isDark ? muted : const Color(0xFF64748B))),
                    ),
                    if (!compact) ...[
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          info.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14,
                            color: selected
                                ? activeFg
                                : (hasFocus ? (isDark ? Colors.white : const Color(0xFF0F172A)) : (isDark ? secondaryInk : const Color(0xFF334155))),
                            fontWeight: isHighlighted ? FontWeight.bold : FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      }),
    );
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: compact ? 8 : Space.sm, vertical: 2.5),
      child: Semantics(
        selected: selected,
        button: true,
        label: info.title,
        child: compact ? Tooltip(message: info.title, waitDuration: const Duration(milliseconds: 300), child: row) : row,
      ),
    );
  }

  Widget _desktopHeader() {
    final offline = widget.app.notice != null;
    final isDemo = widget.app.isDemo;
    final shopTitle = widget.app.shopName ?? _shopName ?? 'POS Kasir Toko';
    final userRole = _roleLabel(widget.app.role);
    final userName = widget.app.userName.isEmpty ? 'Kasir' : widget.app.userName;
    final addressText = widget.app.address != null ? ' (${widget.app.address!.host}:${widget.app.address!.port})' : '';

    return Container(
      height: 52,
      padding: const EdgeInsets.symmetric(horizontal: Space.md),
      decoration: BoxDecoration(
        color: surface,
        border: Border(bottom: BorderSide(color: ruleColor)),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isDemo ? warningColor : (offline ? errorColor : successColor),
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              shopTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            ),
          ),
          const SizedBox(width: Space.sm),
          Text('|', style: TextStyle(color: lineColor)),
          const SizedBox(width: Space.sm),
          Flexible(
            child: Text.rich(
              TextSpan(children: [
                TextSpan(text: 'Kasir: ', style: TextStyle(color: muted, fontSize: 13)),
                TextSpan(
                  text: '$userName ($userRole)',
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ]),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: isDemo ? pillWarningBg : (offline ? pillNegativeBg : pillPositiveBg),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(
                color: (isDemo ? pillWarningInk : (offline ? pillNegativeInk : pillPositiveInk)).withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isDemo ? warningColor : (offline ? errorColor : successColor),
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  isDemo ? 'Mode Demo' : (offline ? 'Server Terputus' : 'Server Terhubung$addressText'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: isDemo ? pillWarningInk : (offline ? pillNegativeInk : pillPositiveInk),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: Space.sm),
          OutlinedButton.icon(
            onPressed: _account,
            icon: const Icon(Icons.lock_outline, size: 14),
            label: const Text('Kunci Kasir'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
              minimumSize: const Size(0, 32),
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sidebar(List<Menu> menus) {
    final compact = _railOnly;
    final groups = <String, List<Menu>>{};
    for (final menu in menus) { (groups[menuInfo[menu]!.group] ??= []).add(menu); }
    final allMenus = [for (final group in groups.values) ...group];
    final offline = widget.app.notice != null;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      width: compact ? 64 : 260,
      color: isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
      child: Column(children: [
        _brand(compact: compact),
        Expanded(child: ListView(padding: const EdgeInsets.only(bottom: Space.md), children: [
          for (final (index, group) in groups.entries.indexed) ...[
            if (compact)
              Padding(padding: EdgeInsets.symmetric(horizontal: 16, vertical: index == 0 ? 0 : 10), child: index == 0 ? const SizedBox() : const Divider())
            else
              Padding(padding: EdgeInsets.fromLTRB(20, index == 0 ? 4 : 20, Space.md, 8),
                child: Text(
                  group.key.toUpperCase(),
                  style: TextStyle(
                    color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.8,
                  ),
                )),
            for (final menu in group.value) _navRow(menu, compact: compact, allMenus: allMenus),
          ],
        ])),
        const Divider(indent: 12, endIndent: 12),
        Padding(padding: const EdgeInsets.all(Space.sm), child: Material(color: Colors.transparent, child: InkWell(
          borderRadius: BorderRadius.circular(Corners.control), onTap: _account,
          child: Padding(padding: EdgeInsets.symmetric(horizontal: compact ? 0 : 10, vertical: 10), child: Row(
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
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: muted))),
                    ]),
                  ])),
                  Icon(Icons.unfold_more, size: 16, color: muted),
                ],
              ])),
            ))),
          ]),
        );
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
      decoration: BoxDecoration(color: pillWarningBg, border: Border(bottom: BorderSide(color: noticeBorder))),
      child: Text('Mode demo · data contoh, tidak dikirim ke toko', style: TextStyle(fontSize: 12, color: pillWarningInk))) : null;
    final updateBanner = _updateBanner();

    if (wide) {
      return Scaffold(body: SafeArea(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SidebarArea(child: _sidebar(widget.app.isDemo ? primaryMenus : menus)),
        const VerticalDivider(width: 1),
        Expanded(child: Column(children: [
          HeaderArea(child: _desktopHeader()),
          if (updateBanner != null) updateBanner,
          if (demoBanner != null) demoBanner,
          Expanded(child: workspace),
        ])),
      ])));
    }

    final offline = widget.app.notice != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(menuInfo[_menu]!.title),
        actions: [
          IconButton(
            onPressed: _account,
            tooltip: widget.app.isDemo
                ? 'Mode Demo'
                : offline
                    ? 'Server terputus'
                    : 'Server terhubung (${widget.app.userName})',
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                if (offline)
                  Icon(Icons.wifi_off, color: errorColor)
                else
                  _Initial(widget.app.userName),
                Positioned(
                  right: -2,
                  bottom: -2,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: offline ? errorColor : successColor,
                      border: Border.all(color: Theme.of(context).scaffoldBackgroundColor, width: 1.5),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: Space.xs),
        ]),
      body: SafeArea(top: false, child: Column(children: [
        if (updateBanner != null) updateBanner,
        if (demoBanner != null) demoBanner,
        Expanded(child: workspace),
      ])),
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
    decoration: BoxDecoration(color: activePill, shape: BoxShape.circle),
    child: Text(name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase(), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: ink)),
  );
}
