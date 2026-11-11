import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/live_models.dart';
import '../state/app_state.dart';
import '../state/theme_controller.dart';
import '../Widgets/admin.dart' show isDesktop;
import '../Widgets/ui.dart';
import '../services/updater_service.dart';

/// The app's own version, dynamically passed or defaulted from UpdaterService.
const mobileAppVersion = UpdaterService.currentAppVersion;

/// Everything about this device and its session in one place: who is signed in, which
/// shop and server it talks to and whether that works right now, the address phones
/// should use, light or dark, the keyboard keys, versions - and the way out. A dialog on
/// a PC, a tall sheet on a phone.
Future<void> showAccountPanel(BuildContext context, {required AppState app, String? shopName, VoidCallback? onOpenSettings}) {
  final panel = _AccountPanel(app: app, shopName: shopName, onOpenSettings: onOpenSettings);
  if (MediaQuery.sizeOf(context).width >= 700) {
    return showDialog<void>(context: context, builder: (_) => Dialog(clipBehavior: Clip.antiAlias,
      insetPadding: const EdgeInsets.all(Space.xl),
      child: ConstrainedBox(constraints: BoxConstraints(maxWidth: 560, maxHeight: MediaQuery.sizeOf(context).height * 0.88), child: panel)));
  }
  return showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, useSafeArea: true,
    builder: (_) => FractionallySizedBox(heightFactor: 0.9, child: panel));
}

class _AccountPanel extends StatefulWidget {
  const _AccountPanel({required this.app, this.shopName, this.onOpenSettings});
  final AppState app;
  final String? shopName;
  final VoidCallback? onOpenSettings;
  @override State<_AccountPanel> createState() => _AccountPanelState();
}

class _AccountPanelState extends State<_AccountPanel> {
  bool checking = false;
  DateTime? checkedAt;
  String? serverVersion, lanAddress;
  int? port;
  /// Access from outside the shop as the server sees it: enabled, online, address.
  Map<String, dynamic>? remote;

  @override void initState() { super.initState(); if (!widget.app.isDemo) check(); }

  /// Asks the server who we are and what it is, and remembers when it answered.
  Future<void> check() async {
    setState(() => checking = true);
    await widget.app.checkConnection();
    try {
      final status = jsonObject(await widget.app.businessRequest('/v1/server/status', method: 'GET'));
      final health = jsonObject(await widget.app.businessRequest('/v1/health', method: 'GET'));
      if (mounted) {
        setState(() {
          lanAddress = status['address']?.toString(); port = (number(status['port']) ?? 48950).toInt(); serverVersion = health['appVersion']?.toString();
          remote = status['remote'] is Map ? jsonObject(status['remote']) : null;
        });
      }
    } catch (_) {
      // the status line already says the server is out of reach
    }
    if (mounted) setState(() { checking = false; checkedAt = DateTime.now(); });
  }

  static String _role(String role) => role == 'admin' ? 'Admin' : role == 'kasir' ? 'Kasir' : role;

  Widget _section(String title, List<Widget> children) => Padding(
    padding: const EdgeInsets.only(top: Space.xl),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(title, style: TextStyle(color: muted, fontSize: 12)),
      const SizedBox(height: Space.sm),
      Container(
        decoration: BoxDecoration(color: surface, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final (i, child) in children.indexed) ...[if (i > 0) Divider(color: ruleColor), child],
        ])),
    ]));

  Widget _row(String label, String value, {Widget? trailing, bool mono = false}) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: 11),
    child: Row(children: [
      Expanded(child: Text(label, style: TextStyle(color: muted, fontSize: 14))),
      const SizedBox(width: Space.md),
      Flexible(child: SelectableText(value, textAlign: TextAlign.end, style: mono ? TextStyle(fontFamily: monoFamily, fontSize: 13, color: ink) : TextStyle(fontSize: 14, color: ink))),
      if (trailing != null) ...[const SizedBox(width: Space.sm), trailing],
    ]));

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.app, appTheme]), builder: (context, _) {
    final app = widget.app;
    final offline = app.notice != null;
    final onThisPc = app.address?.host == '127.0.0.1' || app.address?.host == 'localhost';
    final name = app.userName.trim();
    return Material(color: canvas, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(Space.xl, Space.xl, Space.xl, Space.lg), children: [
        // who is signed in
        Row(children: [
          Container(width: 48, height: 48, alignment: Alignment.center, decoration: BoxDecoration(color: activePill, shape: BoxShape.circle),
            child: Text(name.isEmpty ? '?' : name[0].toUpperCase(), style: TextStyle(fontSize: 20, fontWeight: FontWeight.w500, color: ink))),
          const SizedBox(width: Space.lg),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name.isEmpty ? 'Tanpa nama' : name, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: ink)),
            const SizedBox(height: 4),
            Wrap(spacing: Space.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Pill(app.isDemo ? 'Demo' : _role(app.role)),
              Text(app.shopName ?? widget.shopName ?? 'Point of Sales', style: TextStyle(color: muted, fontSize: 13)),
            ]),
          ])),
        ]),

        if (!app.isDemo) _section('Koneksi', [
          Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.sm, Space.md), child: Row(children: [
            Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: checking ? muted : offline ? errorColor : successColor)),
            const SizedBox(width: Space.md),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(checking ? 'Memeriksa…' : offline ? 'Server tidak terjangkau' : 'Terhubung ke server toko', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: ink)),
              Text(offline && !checking ? app.notice! : checkedAt == null ? 'Belum diperiksa' : 'Diperiksa pukul ${timeText(checkedAt!)}',
                maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 12)),
            ])),
            OutlinedButton.icon(onPressed: checking ? null : check, icon: const Icon(Icons.sync, size: 16), label: const Text('Periksa')),
          ])),
          _row(onThisPc ? 'Server' : 'Alamat server', onThisPc ? 'Berjalan di PC ini' : (app.address?.authority ?? '—')),
          if (onThisPc) _row('Alamat untuk HP', lanAddress == null ? 'PC belum tersambung ke jaringan' : '$lanAddress:${port ?? 48950}', mono: lanAddress != null),
          if (onThisPc && lanAddress != null) Padding(padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.md),
            child: Text(remote?['enabled'] == true
              ? 'HP disambungkan sekali lewat Wi-Fi toko, setelah itu bisa dipakai dari mana saja. Untuk HP baru, buka Pengaturan → Hubungkan HP baru.'
              : 'HP harus memakai Wi-Fi yang sama. Untuk menyambungkan HP baru, buka Pengaturan → Hubungkan HP baru.', style: TextStyle(color: muted, fontSize: 12))),
          if (onThisPc) _row('Akses dari luar toko', remote?['enabled'] != true ? 'Mati' : remote?['online'] == true ? 'Aktif' : 'Menyambung…'),
          if (!onThisPc) _row('Jalur', app.viaInternet ? 'Internet (di luar toko)' : 'Wi-Fi toko'),
          if (!onThisPc) _row('Akses dari luar toko', app.hasRemoteAccess ? 'Siap' : remote?['enabled'] == true ? 'Disiapkan…' : 'Belum diaktifkan di PC'),
        ]),

        _section('Tampilan', [
          Padding(padding: const EdgeInsets.all(Space.lg), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SegmentedButton<ThemeMode>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: ThemeMode.light, icon: const Icon(Icons.light_mode_outlined, size: 18), label: Text(ThemeController.labels[ThemeMode.light]!)),
                ButtonSegment(value: ThemeMode.dark, icon: const Icon(Icons.dark_mode_outlined, size: 18), label: Text(ThemeController.labels[ThemeMode.dark]!)),
                ButtonSegment(value: ThemeMode.system, icon: const Icon(Icons.brightness_auto_outlined, size: 18), label: Text(ThemeController.labels[ThemeMode.system]!)),
              ],
              selected: {appTheme.value},
              onSelectionChanged: (s) => appTheme.choose(s.first),
            ),
            const SizedBox(height: Space.sm),
            Text('Tersimpan di perangkat ini saja.', style: TextStyle(color: muted, fontSize: 12)),
          ])),
        ]),

        if (isDesktop) _section('Tombol pintas kasir', [
          for (final (keys, what) in const [
            ('PageUp', 'ke kolom Jumlah'), ('PageDown / F2', 'ke kolom cari'), ('/', 'palet barang'), ('Alt+P', 'pilih pelanggan'),
            ('F3', 'ubah baris teratas'), ('End / F12', 'bayar'), ('Alt+K', 'kosongkan keranjang'),
            ('Alt+T / B / Q / R', 'tunai / bon / QRIS / transfer'), ('End / Alt+S', 'simpan transaksi'), ('Ctrl+B', 'ciutkan menu samping'),
          ]) Padding(padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: 8), child: Row(children: [
            Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: raised, borderRadius: BorderRadius.circular(Corners.chip), border: Border.all(color: lineColor)),
              child: Text(keys, style: TextStyle(fontFamily: monoFamily, fontSize: 12, color: ink))),
            const SizedBox(width: Space.md),
            Expanded(child: Text(what, style: TextStyle(fontSize: 14, color: ink))),
          ])),
          Padding(padding: const EdgeInsets.fromLTRB(Space.lg, 4, Space.lg, Space.md), child: Text('Pemindai barcode bekerja di mana saja di jendela.', style: TextStyle(color: muted, fontSize: 12))),
        ]),

        _section('Tentang', [
          _row('Aplikasi', 'Point of Sales $mobileAppVersion'),
          if (serverVersion != null) _row('Server', serverVersion!),
          _row('Perangkat', isDesktop ? 'PC (Windows)' : 'HP'),
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.md),
            child: Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  promptAppUpdate(context);
                },
                icon: const Icon(Icons.system_update_outlined, size: 16),
                label: const Text('Periksa pembaruan rilis…'),
              ),
            ),
          ),
        ]),
      ])),

      // the way out, always in view
      Container(
        padding: const EdgeInsets.fromLTRB(Space.xl, Space.md, Space.xl, Space.md),
        decoration: BoxDecoration(color: surface, border: Border(top: BorderSide(color: lineColor))),
        child: Wrap(alignment: WrapAlignment.end, spacing: Space.sm, runSpacing: Space.sm, children: [
          if (widget.onOpenSettings != null && !app.isDemo) OutlinedButton.icon(
            onPressed: () { Navigator.of(context).pop(); widget.onOpenSettings!(); },
            icon: const Icon(Icons.settings_outlined, size: 18), label: const Text('Pengaturan')),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: errorColor),
            onPressed: () { Navigator.of(context).pop(); app.logout(); },
            icon: const Icon(Icons.logout, size: 18), label: Text(app.isDemo ? 'Keluar dari demo' : 'Keluar')),
          FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Tutup')),
        ])),
    ]));
  });
}
