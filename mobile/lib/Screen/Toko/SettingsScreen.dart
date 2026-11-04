import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';

/// Store details, receipt printer, and the phones paired to this server.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.api, required this.isAdmin});
  final StoreApi api;
  final bool isAdmin;
  @override State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Map<String, dynamic> settings = {};
  List<Map<String, dynamic>> printers = [], devices = [];
  bool loading = true, testing = false;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final s = await widget.api.settings();
      final p = await widget.api.printers().catchError((Object _) => <Map<String, dynamic>>[]);
      final d = widget.isAdmin ? await widget.api.devices() : <Map<String, dynamic>>[];
      if (mounted) setState(() { settings = s; printers = p; devices = d; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> editStore() async {
    final values = await showFormDialog(context, title: 'Data toko & struk', fields: [
      FieldSpec('namaToko', 'Nama toko', required: true, initial: settings['namaToko']),
      FieldSpec('alamat', 'Alamat', initial: settings['alamat']),
      FieldSpec('telepon', 'Telepon', initial: settings['telepon']),
      FieldSpec('pesanFooter', 'Pesan di bawah struk', initial: settings['pesanFooter']),
      FieldSpec('printerName', 'Printer struk', kind: FieldKind.choice, initial: settings['printerName'],
        choices: {null: 'Printer default Windows', for (final p in printers) p['name']: p['name'].toString()}),
      FieldSpec('receiptWidth', 'Lebar kertas', kind: FieldKind.choice, required: true, initial: settings['receiptWidth'] ?? '58mm', choices: const {'58mm': '58 mm', '80mm': '80 mm'}),
      FieldSpec('marginMinimalPersen', 'Margin minimal (%)', kind: FieldKind.integer, initial: settings['marginMinimalPersen'], helper: 'Dipakai untuk rekomendasi harga jual'),
    ], onSave: (v) => widget.api.saveSettings(v));
    if (values != null && mounted) { showNotice(context, 'Pengaturan disimpan.', kind: NoticeKind.success); load(); }
  }
  Future<void> testPrint() async {
    setState(() => testing = true);
    await runAction(context, widget.api.testPrint, success: 'Struk contoh dikirim ke printer.');
    if (mounted) setState(() => testing = false);
  }
  Future<void> showPairing() async {
    try {
      final code = await widget.api.pairingCode();
      if (!mounted) return;
      final address = code['serverAddress'];
      if (address == null) throw const FormatException('Server belum terhubung ke jaringan. Sambungkan PC ke Wi-Fi/LAN toko dulu.');
      final payload = '{"address":"$address","code":"${code['code']}"}';
      await showDialog<void>(context: context, builder: (context) => AlertDialog(title: const Text('Hubungkan HP baru'),
        content: SizedBox(width: 320, child: Column(mainAxisSize: MainAxisSize.min, children: [
          QrImageView(data: payload, size: 240, backgroundColor: Colors.white),
          const SizedBox(height: Space.md),
          SelectableText('Alamat $address\nKode ${code['code']}', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: Space.sm),
          const Text('Scan dari aplikasi di HP, lalu login dengan akun kasir. Kode berlaku 5 menit dan hanya sekali pakai.', textAlign: TextAlign.center, style: TextStyle(color: muted, fontSize: 13)),
        ])),
        actions: [FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Selesai'))]));
      load();
    } catch (e) { if (mounted) showError(context, e); }
  }
  Future<void> revoke(Map<String, dynamic> d) async {
    if (!await confirmAction(context, title: 'Cabut ${text(d['namaPerangkat'], 'perangkat')}?', destructive: true, confirmLabel: 'Cabut',
      message: 'Perangkat ini langsung keluar dan harus dihubungkan ulang.')) { return; }
    if (mounted && await runAction(context, () => widget.api.revokeDevice(idNumber(d['id'])))) load();
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: load, maxWidth: 900, children: [
    ScreenHeader('Pengaturan', 'Data toko, printer struk, dan perangkat yang terhubung.'),
    LoadSwitch(loading: loading, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SummaryRow('Nama toko', text(settings['namaToko'])),
        SummaryRow('Alamat', text(settings['alamat'])),
        SummaryRow('Telepon', text(settings['telepon'])),
        SummaryRow('Pesan struk', text(settings['pesanFooter'])),
        SummaryRow('Printer', text(settings['printerName'], 'Printer default Windows')),
        SummaryRow('Lebar kertas', text(settings['receiptWidth'])),
        SummaryRow('Margin minimal', '${settings['marginMinimalPersen'] ?? 10}%'),
        const SizedBox(height: Space.md),
        Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
          if (widget.isAdmin) FilledButton.icon(onPressed: editStore, icon: const Icon(Icons.edit_outlined), label: const Text('Ubah')),
          OutlinedButton.icon(onPressed: testing ? null : testPrint, icon: const Icon(Icons.print_outlined), label: Text(testing ? 'Mencetak…' : 'Tes cetak')),
        ]),
      ])),
      if (widget.isAdmin) ...[
        const SizedBox(height: Space.xl),
        ScreenHeader('Perangkat terhubung', 'HP dan PC yang bisa mengakses server ini.', actions: [
          FilledButton.icon(onPressed: showPairing, icon: const Icon(Icons.qr_code_2), label: const Text('Hubungkan HP baru')),
        ]),
        DataView<Map<String, dynamic>>(rows: devices, emptyTitle: 'Belum ada perangkat',
          actions: (d) => [if (d['revokedAt'] == null) TextButton(onPressed: () => revoke(d), child: const Text('Cabut'))],
          columns: [
            DataCol('Perangkat', (d) => text(d['namaPerangkat'], 'Tanpa nama'), flex: 2),
            DataCol('Akun', (d) => text(d['userName'])),
            DataCol('Terakhir aktif', (d) => d['lastUsedAt'] == null ? '—' : dateTimeLabel(d['lastUsedAt']), flex: 2),
            DataCol('Status', (d) => d['revokedAt'] == null ? 'Aktif' : 'Dicabut'),
          ]),
      ],
    ])),
  ]);
}

/// Accounts that can sign in (admin only).
class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key, required this.api, required this.currentUserId});
  final StoreApi api;
  final String currentUserId;
  @override State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  List<Map<String, dynamic>> rows = [];
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try { final data = await widget.api.users(); if (mounted) setState(() => rows = data); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  static const _roles = {'kasir': 'Kasir', 'admin': 'Admin'};
  Future<void> edit([Map<String, dynamic>? user]) async {
    final values = await showFormDialog(context, title: user == null ? 'Pengguna baru' : 'Ubah ${user['username']}', fields: [
      if (user == null) const FieldSpec('username', 'Username', required: true),
      FieldSpec('name', 'Nama', required: true, initial: user?['name']),
      FieldSpec('role', 'Peran', kind: FieldKind.choice, required: true, initial: user?['role'] ?? 'kasir', choices: _roles),
      FieldSpec('password', user == null ? 'Password' : 'Password baru', kind: FieldKind.password, required: user == null,
        helper: user == null ? 'Minimal 4 karakter' : 'Kosongkan bila tidak diganti'),
    ], onSave: (v) => user == null ? widget.api.createUser(v) : widget.api.updateUser(idNumber(user['id']), v));
    if (values != null && mounted) load();
  }
  Future<void> remove(Map<String, dynamic> user) async {
    if (!await confirmAction(context, title: 'Hapus ${user['username']}?', destructive: true, confirmLabel: 'Hapus',
      message: 'Akun ini tidak bisa login lagi. Transaksi yang pernah dibuatnya tetap ada.')) { return; }
    if (mounted && await runAction(context, () => widget.api.deleteUser(idNumber(user['id'])))) load();
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: load, maxWidth: 900, children: [
    ScreenHeader('Pengguna', 'Akun kasir dan admin.', actions: [
      FilledButton.icon(onPressed: () => edit(), icon: const Icon(Icons.person_add_alt), label: const Text('Pengguna baru')),
    ]),
    LoadSwitch(loading: loading, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows, onTap: edit,
      actions: (u) => [if (u['id'].toString() != widget.currentUserId) IconButton(tooltip: 'Hapus', onPressed: () => remove(u), icon: const Icon(Icons.delete_outline, size: 20))],
      columns: [
        DataCol('Username', (u) => text(u['username'])),
        DataCol('Nama', (u) => text(u['name']), flex: 2),
        DataCol('Peran', (u) => _roles[u['role']] ?? text(u['role'])),
      ])),
  ]);
}
