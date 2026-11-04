import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/Screen/MainScreen.dart';
import '../lib/Screen/menus.dart';
import '../lib/services/mobile_api.dart';
import '../lib/state/app_state.dart';
import 'session_test.dart' show MemoryStorage;

/// Answers every endpoint the store screens read, by path, like a tiny server.
class RoutingTransport implements JsonTransport {
  RoutingTransport(this.role);
  final String role;
  final calls = <(String, String, Map<String, dynamic>?)>[];
  static const page = {'currentPage': 1, 'lastPage': 1, 'total': 1};
  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async {
    calls.add((method, uri.path, body));
    final user = {'id': 1, 'username': role, 'name': 'Uji $role', 'role': role};
    final Object data = switch (uri.path) {
      '/v1/health' => {'ok': true},
      '/v1/auth/login' => {'token': 'tok', 'user': user},
      '/v1/me' => {'user': user},
      '/v1/catalog/search' => {'data': [{'id': 1, 'namaItem': 'Kopi', 'kodeItem': 'K1', 'satuan': 'PCS', 'stok': 5, 'hargaJual': 2000}], ...page},
      '/v1/dashboard' => {
        'summary': {'omzetTunai': 150000, 'omzetNonTunai': 0, 'labaKotor': 20000, 'jumlahTransaksi': 3, 'piutangBeredar': 5000},
        'stokMenipis': [{'id': 1, 'kodeItem': 'K1', 'namaItem': 'Kopi', 'satuan': 'PCS', 'stok': 2}],
        'produkTerlarisHariIni': <Object>[], 'transaksiTerbaru': <Object>[],
      },
      '/v1/sales' => {'data': [{'id': 7, 'namaPelanggan': 'Bu Rina', 'metodePembayaran': 'bon', 'status': 'selesai', 'total': 9000, 'dibayar': 1000, 'createdAt': '2026-10-14T10:00:00.000'}], ...page},
      '/v1/customer-master' || '/v1/suppliers' => {'data': [{'id': 1, 'nama': 'Bu Rina', 'telepon': null, 'alamat': null, 'saleCount': 2, 'purchaseCount': 0}], ...page},
      '/v1/purchases' => {'data': [{'id': 3, 'tanggal': '2026-10-01', 'supplierName': 'CV Maju', 'itemSummary': 'Kopi x10', 'total': 50000, 'sisa': 10000}], 'totalKeseluruhan': 50000, ...page},
      '/v1/supplier-debts' => {'data': [{'purchaseId': 3, 'supplierId': 1, 'supplierName': 'CV Maju', 'tanggal': '2026-10-01', 'total': 50000, 'dibayar': 40000, 'sisa': 10000}]},
      '/v1/products' => {'data': [{'id': 1, 'kodeItem': 'K1', 'namaItem': 'Kopi', 'categoryName': 'Minuman', 'satuan': 'PCS', 'stok': 5, 'hargaPokok': 1500, 'hargaJual': 2000, 'isActive': true}], ...page},
      '/v1/units' => {'data': [{'id': 1, 'code': 'PCS', 'name': 'Pieces', 'symbol': 'pcs', 'isActive': true}]},
      '/v1/opname/categories' => {'data': [{'id': 1, 'nama': 'Minuman'}]},
      '/v1/opname/products' => {'data': <Object>[]},
      '/v1/stock-movements' => {'data': [{'id': 1, 'createdAt': '2026-10-14T10:00:00.000', 'namaItem': 'Kopi', 'movementType': 'sale', 'quantity': -1, 'satuan': 'PCS', 'stockBefore': 6, 'stockAfter': 5, 'baseUnit': 'PCS'}], ...page},
      '/v1/expenses' => {'data': [{'id': 1, 'tanggal': '2026-10-14', 'kategori': 'BENSIN', 'jumlah': 25000, 'keterangan': null, 'userName': 'Uji'}], 'totalJumlah': 25000, ...page},
      '/v1/rekap' => {'summary': {'omzetTunai': 1, 'omzetNonTunai': 0, 'labaKotor': 1, 'jumlahTransaksi': 1, 'piutangBeredar': 0},
        'penjelasanLaba': {'penjualanKotor': 1, 'diskonItem': 0, 'diskonNota': 0, 'omzet': 1, 'modal': 0, 'labaKotor': 1, 'jumlahBarisRugi': 0, 'totalRugi': 0, 'saran': <Object>[]},
        'labaPerKategori': <Object>[], 'labaPerHari': <Object>[], 'labaPerSatuan': <Object>[], 'produkTerlaris': <Object>[],
        'pembelianPerSupplier': <Object>[], 'piutangPerPelanggan': <Object>[], 'stockValue': {'totalNilai': 0, 'produk': <Object>[]}, 'salesHistory': <Object>[]},
      '/v1/users' => {'data': [{'id': 1, 'username': 'admin', 'name': 'Admin', 'role': 'admin'}]},
      '/v1/settings' => {'namaToko': 'Toko Uji', 'alamat': null, 'telepon': null, 'pesanFooter': null, 'printerName': null, 'receiptWidth': '58mm', 'marginMinimalPersen': 10},
      '/v1/printers' => {'data': <Object>[]},
      '/v1/devices' => {'data': <Object>[]},
      _ => throw StateError('Unexpected ${uri.path}'),
    };
    return ApiResponse(200, data);
  }
}

Future<AppState> signedIn(String role) async {
  final app = AppState(api: MobileApi(transport: RoutingTransport(role)), storage: MemoryStorage());
  await app.login(host: '192.168.1.5:48950', username: role, password: 'x', deviceName: 'HP');
  return app;
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) { await tester.pump(const Duration(milliseconds: 100)); }
}

void main() {
  test('a kasir does not get the admin-only menus', () async {
    final kasir = await signedIn('kasir');
    final admin = await signedIn('admin');

    expect(menusFor(kasir), isNot(contains(Menu.rekap)));
    expect(menusFor(kasir), isNot(contains(Menu.pengguna)));
    expect(menusFor(kasir), contains(Menu.pengeluaran));
    expect(menusFor(admin), containsAll([Menu.rekap, Menu.pengguna]));
    expect(menusFor(kasir.isDemo ? kasir : (AppState()..startDemo())), primaryMenus);
  });

  testWidgets('on a phone every extra menu opens from "Lainnya"', (tester) async {
    tester.view.physicalSize = const Size(390, 844); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final app = await tester.runAsync(() => signedIn('admin'));
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: MainScreen(app: app!)));
    await settle(tester);

    for (final menu in menusFor(app).where((m) => !primaryMenus.contains(m))) {
      await tester.tap(find.text('Lainnya'));
      await settle(tester);
      await tester.tap(find.text(menuInfo[menu]!.title).last);
      await settle(tester);
      expect(tester.takeException(), isNull, reason: menu.name);
      expect(find.widgetWithText(AppBar, menuInfo[menu]!.title), findsOneWidget, reason: menu.name);
    }

    // a bon in the history still owes money, and says so
    await tester.tap(find.text('Riwayat').last);
    await settle(tester);
    expect(find.textContaining('belum lunas'), findsOneWidget);
    expect(find.text('Nota #7'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
