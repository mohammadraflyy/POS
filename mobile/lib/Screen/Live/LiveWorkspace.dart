import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../state/live_store.dart';
import '../../services/store_api.dart';
import '../../services/mutation_guard.dart';
import '../../services/draft_store.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../Widgets/admin.dart' show PageTabs, text;
import '../../models/live_models.dart';
import '../../services/mobile_api.dart' show ApiFailure;
import '../menus.dart';
import '../Toko/DashboardScreen.dart';
import '../Toko/ProductsScreen.dart';
import '../Toko/PurchasesScreen.dart';
import '../Toko/ReportsScreen.dart';
import '../Toko/SettingsScreen.dart';
import 'LiveKasirScreen.dart';
import 'LivePurchaseScreen.dart';
import 'LiveOpnameScreen.dart';
import 'LiveHistoryScreen.dart';
class LiveWorkspace extends StatefulWidget {
  const LiveWorkspace({super.key, required this.app, required this.menu, required this.menus, this.onOpenMenu});

  /// Switches the shell to another menu (the till, when a nota is opened for editing).
  final void Function(Menu menu)? onOpenMenu;
  final AppState app;
  final Menu menu;
  final List<Menu> menus;
  @override State<LiveWorkspace> createState() => _LiveWorkspaceState();
}
class _LiveWorkspaceState extends State<LiveWorkspace> {
  late final StoreApi api;
  late final MutationGuard guard;
  late final LiveStore store;
  // screens are built the first time they are opened, then kept alive
  final _opened = <Menu>{Menu.kasir};
  @override void initState() {
    super.initState(); api = StoreApi(widget.app.businessRequest, widget.app.businessFile);
    guard = MutationGuard(SecurePendingStore('${widget.app.address}|${widget.app.userId}'));
    store = LiveStore(api, guard, drafts: DraftStore.forDevice('${widget.app.address?.authority}|${widget.app.userId}'), viaInternet: () => widget.app.viaInternet);
    guard.load(); _opened.add(widget.menu);
    store.restoreDraft().then((count) {
      if (count > 0 && mounted) showNotice(context, 'Keranjang terakhir dipulihkan: $count barang.', kind: NoticeKind.info);
    });
  }
  @override void didUpdateWidget(covariant LiveWorkspace oldWidget) { super.didUpdateWidget(oldWidget); _opened.add(widget.menu); }
  @override void dispose() { store.dispose(); guard.dispose(); super.dispose(); }
  Future<void> _review() async {
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: const Text('Periksa hasil di PC'),
      content: Text('${guard.pending?['operation'] ?? 'Transaksi'} • ${guard.pending?['time'] ?? ''}\n\nPeriksa riwayat atau data pada PC untuk memastikan apakah operasi ini sudah tersimpan. Jangan membuat ulang jika sudah tercatat.'),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Belum diperiksa')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sudah saya periksa di PC'))]));
    if (confirmed == true) { try { await guard.acknowledgeChecked(); store.clear(); } catch (e) { if (mounted) showError(context, e); } }
  }
  /// Loads a saved nota into the till's cart, the way the desktop's "Edit nota" did: each
  /// line keeps the price it was sold at, and the sale keeps its date, charge and note.
  Future<void> _editSale(int saleId) async {
    final data = jsonObject(await api.get('/v1/sales/$saleId/edit'));
    if (data['status'] != 'selesai') throw const ApiFailure('Hanya nota yang selesai yang bisa diubah.');
    final details = <int, Map<String, dynamic>>{};
    final lines = <LiveCartItem>[];
    for (final raw in (data['items'] as List).whereType<Map>()) {
      final item = jsonObject(raw);
      final productId = idNumber(item['productId']);
      final detail = details[productId] ??= await api.product(productId);
      final units = jsonRows(detail['units']);
      final base = units.where((u) => u['isBaseUnit'] == true).firstOrNull;
      final liveUnits = [
        LiveUnit(null, text(base?['satuan'], 'Satuan dasar'), number(base?['hargaJual'])),
        for (final u in units.where((u) => u['isBaseUnit'] != true)) LiveUnit(idNumber(u['id']), text(u['satuan']), number(u['hargaJual'])),
      ];
      final product = LiveProduct(productId, text(detail['namaItem']), text(detail['kodeItem'], ''), null, liveUnits);
      final unitRowId = item['productUnitId'] == null ? null : idNumber(item['productUnitId']);
      final unit = unitRowId == null || unitRowId == idNumber(base?['id'] ?? -1) ? liveUnits.first : liveUnits.where((u) => u.id == unitRowId).firstOrNull;
      if (unit == null) throw ApiFailure('Nota ini tidak bisa diubah: satuan ${product.name} sudah dihapus.');
      final lineDiscount = number(item['diskon']) ?? 0;
      lines.add(LiveCartItem(product: product, unit: unit, quantity: number(item['qty']) ?? 1,
        manualPrice: number(item['hargaJual']), discount: lineDiscount > 0 ? lineDiscount : null));
    }
    store.startEdit(saleId: saleId, lines: lines,
      date: DateTime.tryParse(data['createdAt']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      method: data['metodePembayaran']?.toString() ?? 'tunai', customer: data['namaPelanggan']?.toString() ?? '',
      paid: number(data['dibayar']) ?? 0, charge: number(data['biayaLain']) ?? 0, text: data['keterangan']?.toString() ?? '',
      billDiscount: number(data['diskon']) ?? 0);
    widget.onOpenMenu?.call(Menu.kasir);
  }

  Widget _screen(Menu menu) {
    final admin = widget.app.isAdmin;
    return switch (menu) {
      Menu.kasir => LiveKasirScreen(store: store, active: widget.menu == Menu.kasir),
      Menu.pembelian => DefaultTabController(length: 2, child: Column(children: [
        const PageTabs(tabs: ['Catat pembelian', 'Daftar pembelian']),
        Expanded(child: TabBarView(children: [
          WorkArea(child: LivePurchaseScreen(api: api, guard: guard, onSaved: store.stockChanged, active: widget.menu == Menu.pembelian)),
          PurchaseListScreen(api: api, onChanged: store.stockChanged, guard: guard),
        ])),
      ])),
      Menu.opname => WorkArea(child: LiveOpnameScreen(api: api, guard: guard, onSaved: store.stockChanged)),
      Menu.riwayat => LiveHistoryScreen(api: api, isAdmin: admin, onEditSale: admin ? _editSale : null),
      Menu.dashboard => DashboardScreen(api: api),
      Menu.produk => ProductsHub(api: api, isAdmin: admin, active: widget.menu == Menu.produk),
      Menu.hutang => SupplierDebtScreen(api: api, guard: guard, onChanged: store.stockChanged),
      Menu.supplier => PartiesScreen(api: api, isAdmin: admin, customers: false),
      Menu.pelanggan => PartiesScreen(api: api, isAdmin: admin, customers: true),
      Menu.pengeluaran => ExpensesScreen(api: api, isAdmin: admin),
      Menu.kartuStok => StockLedgerScreen(api: api),
      Menu.rekap => RekapScreen(api: api, onEditSale: admin ? _editSale : null, onOpenMenu: widget.onOpenMenu, isAdmin: admin),
      Menu.pengguna => UsersScreen(api: api, currentUserId: widget.app.userId),
      Menu.pengaturan => SettingsScreen(api: api, isAdmin: admin, app: widget.app),
    };
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([guard, store]), builder: (context, _) => NoticeListener(
    message: guard.error ?? (guard.pending != null && !guard.busy ? 'Hasil transaksi belum dapat dipastikan. Periksa data di PC sebelum menyimpan lagi. Jangan mengulangi transaksi yang sudah tercatat.' : null),
    child: NoticeListener(kind: NoticeKind.error, message: store.priceError,
      child: NoticeListener(message: store.price != null && !store.price!.stockEnough ? 'Stok tidak cukup untuk jumlah dalam keranjang. Kurangi jumlah atau pilih barang lain sebelum membayar.' : null,
        child: Column(children: [
    if (!guard.ready || (guard.pending != null && !guard.busy) || guard.error != null)
      Container(color: pillWarningBg, padding: const EdgeInsets.all(12), child: Row(children: [
        Expanded(child: Text(guard.error ?? (guard.pending != null ? 'Ada transaksi yang perlu diperiksa hasilnya di PC.' : 'Memeriksa status transaksi perangkat…'), style: TextStyle(color: muted, fontSize: 13))),
        if (!guard.ready) TextButton(onPressed: guard.load, child: const Text('Coba lagi')),
        if (guard.pending != null && !guard.busy) TextButton(onPressed: _review, child: const Text('Periksa')),
      ])),
    Expanded(child: IndexedStack(index: widget.menus.indexOf(widget.menu).clamp(0, widget.menus.length - 1), children: [
      for (final menu in widget.menus) _opened.contains(menu) ? _screen(menu) : const SizedBox(),
    ])),
  ])))));
}
