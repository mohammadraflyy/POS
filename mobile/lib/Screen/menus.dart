import 'package:flutter/material.dart';
import '../state/app_state.dart';

enum Menu { kasir, riwayat, pelanggan, pembelian, hutang, supplier, produk, opname, kartuStok, dashboard, pengeluaran, rekap, pengguna, pengaturan }

class MenuInfo {
  const MenuInfo(this.title, this.icon, this.group, {this.adminOnly = false});
  final String title, group;
  final IconData icon;
  final bool adminOnly;
}

const menuInfo = {
  Menu.dashboard: MenuInfo('Dashboard', Icons.dashboard_outlined, 'Ringkasan'),
  Menu.kasir: MenuInfo('Kasir', Icons.storefront_outlined, 'Penjualan'),
  Menu.riwayat: MenuInfo('Riwayat', Icons.receipt_long_outlined, 'Penjualan'),
  Menu.pelanggan: MenuInfo('Pelanggan', Icons.people_outline, 'Penjualan'),
  Menu.pembelian: MenuInfo('Pembelian', Icons.shopping_bag_outlined, 'Pembelian & stok'),
  Menu.hutang: MenuInfo('Hutang supplier', Icons.account_balance_wallet_outlined, 'Pembelian & stok'),
  Menu.supplier: MenuInfo('Supplier', Icons.local_shipping_outlined, 'Pembelian & stok'),
  Menu.produk: MenuInfo('Produk', Icons.category_outlined, 'Pembelian & stok'),
  Menu.opname: MenuInfo('Opname', Icons.inventory_2_outlined, 'Pembelian & stok'),
  Menu.kartuStok: MenuInfo('Kartu stok', Icons.swap_vert, 'Pembelian & stok'),
  Menu.pengeluaran: MenuInfo('Pengeluaran', Icons.money_off_outlined, 'Kas & laporan'),
  Menu.rekap: MenuInfo('Rekap', Icons.bar_chart_outlined, 'Kas & laporan', adminOnly: true),
  Menu.pengguna: MenuInfo('Pengguna', Icons.manage_accounts_outlined, 'Admin', adminOnly: true),
  Menu.pengaturan: MenuInfo('Pengaturan', Icons.settings_outlined, 'Admin'),
};

/// The four the phone's bottom bar always shows; the rest live under "Lainnya".
const primaryMenus = [Menu.kasir, Menu.pembelian, Menu.opname, Menu.riwayat];

/// What this account may open. Demo mode has only the four till screens.
List<Menu> menusFor(AppState app) {
  if (app.isDemo) return primaryMenus;
  return [for (final entry in menuInfo.entries) if (!entry.value.adminOnly || app.isAdmin) entry.key];
}
