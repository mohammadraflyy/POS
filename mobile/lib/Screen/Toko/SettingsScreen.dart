import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../core/format.dart';
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
  /// Clears test or mistaken sales made today and returns their stock. Bons that already
  /// took a payment are skipped.
  Future<void> purgeToday() async {
    if (!await confirmAction(context, title: 'Hapus transaksi hari ini?', destructive: true, confirmLabel: 'Hapus permanen',
      message: 'Semua transaksi hari ini dihapus permanen dan stok yang terjual dikembalikan, termasuk bon yang belum ada pembayarannya. '
        'Bon yang sudah ada pembayarannya dilewati. Tindakan ini tidak bisa dibatalkan.')) { return; }
    try {
      final result = await widget.api.purgeTodaySales();
      if (!mounted) return;
      final skipped = (number(result['skipped']) ?? 0).toInt();
      showNotice(context, skipped > 0
        ? '${result['deleted']} transaksi dihapus, $skipped dilewati (sudah ada pembayaran bon).'
        : '${result['deleted']} transaksi dihapus.', kind: NoticeKind.success);
    } catch (e) { if (mounted) showError(context, e); }
  }

  /// Drops old history before a date. Stock stays as it is; unpaid bons go with it.
  Future<void> purgeBefore() async {
    String? before;
    final picked = await showFormDialog(context, title: 'Hapus riwayat transaksi', saveLabel: 'Lanjut', fields: const [
      FieldSpec('before', 'Hapus semua transaksi sebelum tanggal', kind: FieldKind.date, required: true),
    ]);
    before = picked?['before']?.toString();
    if (before == null || !mounted) return;
    if (!await confirmAction(context, title: 'Hapus riwayat sebelum ${dateText(DateTime.parse(before))}?', destructive: true, confirmLabel: 'Hapus permanen',
      message: 'Semua transaksi sebelum tanggal ini dihapus permanen, termasuk bon yang belum lunas - piutangnya ikut hilang. '
        'Tindakan ini tidak bisa dibatalkan.')) { return; }
    try {
      final result = await widget.api.purgeSalesBefore(before);
      if (mounted) showNotice(context, '${result['deleted']} transaksi dihapus.', kind: NoticeKind.success);
    } catch (e) { if (mounted) showError(context, e); }
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
          if (widget.isAdmin) OutlinedButton.icon(onPressed: editStore, icon: const Icon(Icons.edit_outlined, size: 18), label: const Text('Ubah data toko')),
          OutlinedButton.icon(onPressed: testing ? null : testPrint, icon: const Icon(Icons.print_outlined), label: Text(testing ? 'Mencetak…' : 'Tes cetak')),
        ]),
      ])),
      if (widget.isAdmin) ...[
        const SizedBox(height: Space.xl),
        ScreenHeader('Perangkat terhubung', 'HP dan PC yang bisa mengakses server ini.', section: true, actions: [
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
        const SizedBox(height: Space.xl),
        const ScreenHeader('Zona berbahaya', 'Tindakan permanen yang tidak bisa dibatalkan.', section: true),
        Container(
          padding: const EdgeInsets.all(Space.lg),
          decoration: BoxDecoration(color: surface, border: Border.all(color: errorColor.withValues(alpha: 0.5)), borderRadius: BorderRadius.circular(Corners.panel)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Hapus transaksi hari ini', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: Space.xs),
            const Text('Untuk membersihkan transaksi tes atau salah input. Stoknya dikembalikan; bon yang sudah dibayar sebagian dilewati.', style: TextStyle(color: muted)),
            const SizedBox(height: Space.md),
            Align(alignment: Alignment.centerLeft, child: OutlinedButton.icon(onPressed: purgeToday,
              style: OutlinedButton.styleFrom(foregroundColor: errorColor), icon: const Icon(Icons.delete_sweep_outlined), label: const Text('Hapus transaksi hari ini'))),
            const Divider(height: Space.xxl),
            const Text('Hapus riwayat transaksi', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: Space.xs),
            const Text('Hapus semua transaksi sebelum tanggal tertentu, termasuk bon yang belum lunas. Stok tidak berubah.', style: TextStyle(color: muted)),
            const SizedBox(height: Space.md),
            Align(alignment: Alignment.centerLeft, child: OutlinedButton.icon(onPressed: purgeBefore,
              style: OutlinedButton.styleFrom(foregroundColor: errorColor), icon: const Icon(Icons.history_toggle_off), label: const Text('Hapus riwayat…'))),
          ]),
        ),
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
