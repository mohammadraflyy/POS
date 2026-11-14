import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/barcode_burst.dart';
import '../../services/store_api.dart';
import '../../services/updater_service.dart';
import '../../state/app_state.dart';
import '../../state/kasir_keys.dart';
import '../../state/theme_controller.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/receipt_preview.dart';
import '../../Widgets/ui.dart';
import '../Pairing/ScanScreen.dart';
import 'RemoteAccessSection.dart';

/// Store details, receipt printer, and the phones paired to this server.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.api, required this.isAdmin, this.app});
  final StoreApi api;
  final bool isAdmin;
  final AppState? app;
  @override State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Map<String, dynamic> settings = {};
  Uint8List? _logoBytes;
  List<Map<String, dynamic>> printers = [], devices = [];
  bool loading = true, testing = false;
  bool _showReceiptPreview = false;
  String? error;
  final _updater = UpdaterService();
  bool _checkingUpdate = false;
  String? _updateStatus;
  double? _downloadProgress;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final s = await widget.api.settings();
      Uint8List? logo;
      if (s['logoVersion'] != null) {
        try {
          final res = await widget.api.logo();
          logo = Uint8List.fromList(res.bytes);
        } catch (_) {}
      }
      final p = await widget.api.printers().catchError((Object _) => <Map<String, dynamic>>[]);
      final d = widget.isAdmin ? await widget.api.devices() : <Map<String, dynamic>>[];
      if (mounted) setState(() { settings = s; _logoBytes = logo; printers = p; devices = d; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> editStoreData() async {
    final values = await showFormDialog(context, title: 'Data Toko', fields: [
      FieldSpec('namaToko', 'Nama toko', required: true, initial: settings['namaToko']),
      FieldSpec('alamat', 'Alamat toko', initial: settings['alamat']),
      FieldSpec('telepon', 'Nomor telepon / WhatsApp', initial: settings['telepon']),
      FieldSpec('marginMinimalPersen', 'Margin minimal (%)', kind: FieldKind.integer, initial: settings['marginMinimalPersen'], helper: 'Dipakai untuk rekomendasi harga jual'),
    ], onSave: (v) {
      final merged = Map<String, dynamic>.from(settings)..addAll(v);
      return widget.api.saveSettings(merged);
    });
    if (values != null && mounted) {
      showNotice(context, 'Data toko berhasil disimpan.', kind: NoticeKind.success);
      await widget.app?.refreshBranding();
      load();
    }
  }

  Future<void> editReceiptSettings() async {
    final values = await showFormDialog(context, title: 'Pengaturan Struk & Printer', fields: [
      FieldSpec('printerName', 'Printer struk', kind: FieldKind.choice, initial: settings['printerName'],
        choices: {null: 'Printer default Windows', for (final p in printers) p['name']: p['name'].toString()}),
      FieldSpec('receiptWidth', 'Lebar kertas kasir', kind: FieldKind.choice, required: true, initial: settings['receiptWidth'] ?? '58mm', choices: const {'58mm': '58 mm', '80mm': '80 mm'}),
      FieldSpec('pesanFooter', 'Pesan di bawah struk', kind: FieldKind.multiline, initial: settings['pesanFooter'], helper: 'Contoh: Terima kasih atas kunjungan Anda'),
    ], onSave: (v) {
      final merged = Map<String, dynamic>.from(settings)..addAll(v);
      return widget.api.saveSettings(merged);
    });
    if (values != null && mounted) {
      showNotice(context, 'Pengaturan struk berhasil disimpan.', kind: NoticeKind.success);
      load();
    }
  }

  Future<void> _uploadLogo() async {
    final picked = await pickImage();
    if (picked == null || !mounted) return;
    try {
      await widget.api.uploadLogo(picked.$2);
      if (mounted) {
        showNotice(context, 'Logo toko berhasil diperbarui.', kind: NoticeKind.success);
        await widget.app?.refreshBranding();
        load();
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _deleteLogo() async {
    if (!await confirmAction(context, title: 'Hapus logo toko?', destructive: true, confirmLabel: 'Hapus',
      message: 'Aplikasi akan kembali menggunakan logo standar struk POS.')) { return; }
    try {
      await widget.api.deleteLogo();
      if (mounted) {
        showNotice(context, 'Logo toko dihapus.', kind: NoticeKind.info);
        await widget.app?.refreshBranding();
        load();
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _checkAppUpdate() async {
    setState(() { _checkingUpdate = true; _updateStatus = 'Menghubungi server rilis…'; });
    try {
      final info = await _updater.checkForUpdate();
      if (!mounted) return;
      if (info == null) {
        setState(() { _updateStatus = 'Aplikasi sudah versi terbaru.'; });
        showNotice(context, 'Aplikasi sudah versi terbaru.', kind: NoticeKind.info);
        return;
      }
      if (info.isNewer && info.downloadUrl != null) {
        setState(() { _updateStatus = 'Versi ${info.latestVersion} tersedia!'; });
        final doUpdate = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text('Pembaruan ${info.latestVersion} Tersedia'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Versi saat ini: ${info.currentVersion}'),
                Text('Versi terbaru: ${info.latestVersion}', style: const TextStyle(fontWeight: FontWeight.bold)),
                if (info.changelog.isNotEmpty) ...[
                  const SizedBox(height: Space.sm),
                  const Text('Catatan Rilis:', style: TextStyle(fontWeight: FontWeight.w600)),
                  Text(info.changelog, maxLines: 5, overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 13)),
                ],
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Nanti')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Perbarui Sekarang')),
            ],
          ),
        );
        if (doUpdate == true && mounted) {
          setState(() { _downloadProgress = 0.0; _updateStatus = 'Mengunduh ${info.fileName ?? 'update'}…'; });
          await _updater.downloadAndInstall(
            downloadUrl: info.downloadUrl!,
            fileName: info.fileName ?? 'Point-of-Sales-update.apk',
            onProgress: (received, total) {
              if (mounted && total > 0) {
                setState(() => _downloadProgress = received / total);
              }
            },
          );
          if (mounted) {
            setState(() { _downloadProgress = null; _updateStatus = 'Pembaruan siap dipasang.'; });
          }
        }
      } else {
        setState(() { _updateStatus = 'Aplikasi sudah versi terbaru (${info.currentVersion}).'; });
        showNotice(context, 'Aplikasi sudah versi terbaru (${info.currentVersion}).', kind: NoticeKind.info);
      }
    } catch (e) {
      if (mounted) {
        setState(() { _updateStatus = 'Gagal memeriksa rilis: $e'; });
        showError(context, e);
      }
    } finally {
      if (mounted) setState(() => _checkingUpdate = false);
    }
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
      final pin = code['code']?.toString() ?? '';
      final expiresAt = code['expiresAt'];
      final payload = address == null ? null : '{"address":"$address","code":"$pin"}';
      await showDialog<void>(context: context, builder: (context) => AlertDialog(title: const Text('Hubungkan HP baru'),
        content: SizedBox(width: 320, child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (payload != null) ...[
            QrImageView(data: payload, size: 240, backgroundColor: Colors.white),
            const SizedBox(height: Space.md),
          ] else Padding(
            padding: const EdgeInsets.only(bottom: Space.md),
            child: Text('Server belum terhubung ke jaringan Wi-Fi/LAN toko. Sambungkan PC ke jaringan agar QR muncul.',
              textAlign: TextAlign.center, style: TextStyle(color: warningColor, fontSize: 13)),
          ),
          SelectableText('${address == null ? '' : 'Alamat $address\n'}Kode $pin', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (expiresAt != null) Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Berlaku sampai ${dateTimeLabel(expiresAt)}', textAlign: TextAlign.center, style: TextStyle(color: muted, fontSize: 12)),
          ),
          const SizedBox(height: Space.sm),
          Text('Scan dari aplikasi di HP, lalu login dengan akun kasir. Kode berlaku 5 menit dan hanya sekali pakai.', textAlign: TextAlign.center, style: TextStyle(color: muted, fontSize: 13)),
        ])),
        actions: [
          TextButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: pin));
              showNotice(context, 'Kode $pin disalin.', kind: NoticeKind.info);
            },
            icon: const Icon(Icons.copy, size: 16),
            label: const Text('Salin kode'),
          ),
          FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Selesai')),
        ]));
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

  @override Widget build(BuildContext context) => ScreenBody(onRefresh: load, children: [
    ScreenHeader('Pengaturan', 'Data toko, printer struk, dan perangkat yang terhubung.'),
    LoadSwitch(loading: loading, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const ScreenHeader('Data Toko', 'Identitas toko, alamat operasional, kontak, dan margin penjualan.', section: true),
      WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SummaryRow('Nama toko', text(settings['namaToko'])),
        SummaryRow('Alamat', text(settings['alamat'])),
        SummaryRow('Telepon', text(settings['telepon'])),
        SummaryRow('Margin minimal', '${settings['marginMinimalPersen'] ?? 10}%'),
        if (widget.isAdmin) ...[
          const SizedBox(height: Space.md),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: editStoreData,
              icon: const Icon(Icons.storefront_outlined, size: 18),
              label: const Text('Ubah data toko'),
            ),
          ),
        ],
      ])),
      const SizedBox(height: Space.xl),
      const ScreenHeader('Pengaturan Struk & Printer', 'Konfigurasi printer kasir, ukuran kertas struk, dan pesan bawah nota.', section: true),
      WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SummaryRow('Printer struk', text(settings['printerName'], 'Printer default Windows')),
        SummaryRow('Lebar kertas', (settings['receiptWidth'] ?? '').toString().replaceAll(' ', '') == '80mm' ? '80 mm' : '58 mm'),
        SummaryRow('Pesan struk', text(settings['pesanFooter'])),
        const SizedBox(height: Space.md),
        Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
          if (widget.isAdmin)
            OutlinedButton.icon(
              onPressed: editReceiptSettings,
              icon: const Icon(Icons.receipt_long_outlined, size: 18),
              label: const Text('Ubah pengaturan struk'),
            ),
          OutlinedButton.icon(
            onPressed: () => setState(() => _showReceiptPreview = !_showReceiptPreview),
            icon: Icon(_showReceiptPreview ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 18),
            label: Text(_showReceiptPreview ? 'Tutup pratinjau' : 'Pratinjau struk'),
          ),
          OutlinedButton.icon(
            onPressed: testing ? null : testPrint,
            icon: const Icon(Icons.print_outlined, size: 18),
            label: Text(testing ? 'Mencetak…' : 'Tes cetak struk'),
          ),
        ]),
        if (_showReceiptPreview) ...[
          const SizedBox(height: Space.lg),
          const Divider(),
          const SizedBox(height: Space.sm),
          Center(
            child: ReceiptPaperPreview(
              storeName: text(settings['namaToko'], 'NAMA TOKO'),
              address: text(settings['alamat']),
              phone: text(settings['telepon']),
              footer: text(settings['pesanFooter'], 'Terima kasih atas kunjungan Anda'),
              initialIs80mm: (settings['receiptWidth'] ?? '').toString().replaceAll(' ', '') == '80mm',
              logoBytes: _logoBytes,
              onWidthChanged: (is80) {
                setState(() {
                  settings['receiptWidth'] = is80 ? '80mm' : '58mm';
                });
              },
            ),
          ),
        ],
      ])),
      const SizedBox(height: Space.xl),
      const ScreenHeader('Logo Toko', 'Logo yang tampil di bilah navigasi aplikasi, struk, dan menu.', section: true),
      WhitePanel(child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        BrandMark(size: 64, logo: _logoBytes),
        const SizedBox(width: Space.lg),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_logoBytes != null ? 'Logo kustom aktif' : 'Menggunakan logo default',
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
          const SizedBox(height: 4),
          Text(_logoBytes != null
            ? 'Format PNG, JPG, atau WebP (maksimal 2 MB).'
            : 'Pasang logo tokomu agar tampil personal di aplikasi dan struk.',
            style: TextStyle(color: muted, fontSize: 13)),
          if (widget.isAdmin) ...[
            const SizedBox(height: Space.md),
            Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
              OutlinedButton.icon(
                onPressed: _uploadLogo,
                icon: const Icon(Icons.upload_file_outlined, size: 18),
                label: Text(_logoBytes != null ? 'Ganti logo' : 'Pilih logo…'),
              ),
              if (_logoBytes != null)
                TextButton.icon(
                  onPressed: _deleteLogo,
                  style: TextButton.styleFrom(foregroundColor: errorColor),
                  icon: const Icon(Icons.delete_outline, size: 18),
                  label: const Text('Hapus logo'),
                ),
            ]),
          ],
        ])),
      ])),
      const SizedBox(height: Space.xl),
      const ScreenHeader('Tampilan', 'Pilih tema terang, gelap, atau mengikuti sistem.', section: true),
      WhitePanel(child: ValueListenableBuilder<ThemeMode>(
        valueListenable: appTheme,
        builder: (context, mode, _) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SegmentedButton<ThemeMode>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: ThemeMode.light, icon: const Icon(Icons.light_mode_outlined, size: 18), label: Text(ThemeController.labels[ThemeMode.light]!)),
              ButtonSegment(value: ThemeMode.dark, icon: const Icon(Icons.dark_mode_outlined, size: 18), label: Text(ThemeController.labels[ThemeMode.dark]!)),
              ButtonSegment(value: ThemeMode.system, icon: const Icon(Icons.brightness_auto_outlined, size: 18), label: Text(ThemeController.labels[ThemeMode.system]!)),
            ],
            selected: {mode},
            onSelectionChanged: (s) => appTheme.choose(s.first),
          ),
          const SizedBox(height: Space.sm),
          Text('Tersimpan di perangkat ini saja.', style: TextStyle(color: muted, fontSize: 12)),
        ]),
      )),
      if (isDesktop) ...[
        const SizedBox(height: Space.xl),
        const ScreenHeader('Keyboard kasir', 'Pilih tombol untuk berpindah antara Jumlah, cari barang, dan keranjang.', section: true),
        WhitePanel(child: ValueListenableBuilder<KasirKeyLayout>(
          valueListenable: kasirKeys,
          builder: (context, layout, _) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SegmentedButton<KasirKeyLayout>(
              showSelectedIcon: false,
              segments: [for (final l in KasirKeyLayout.values) ButtonSegment(value: l, label: Text(KasirKeysController.labels[l]!))],
              selected: {layout},
              onSelectionChanged: (s) => kasirKeys.choose(s.first),
            ),
            const SizedBox(height: Space.sm),
            Text(KasirKeysController.descriptions[layout]!, style: TextStyle(color: ink, fontSize: 13)),
            const SizedBox(height: Space.xs),
            Text('Tersimpan di perangkat ini saja.', style: TextStyle(color: muted, fontSize: 12)),
          ]),
        )),
      ],
      const SizedBox(height: Space.xl),
      const ScreenHeader('Pembaruan Aplikasi', 'Periksa versi terbaru aplikasi dari rilis Git.', section: true),
      WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.system_update_outlined, color: ink, size: 24),
          const SizedBox(width: Space.md),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Point of Sales v${UpdaterService.currentAppVersion}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
            const SizedBox(height: 2),
            Text(_updateStatus ?? 'Aplikasi siap memeriksa rilis terbaru.', style: TextStyle(color: muted, fontSize: 12)),
          ])),
          OutlinedButton.icon(
            onPressed: _checkingUpdate ? null : _checkAppUpdate,
            icon: Icon(_checkingUpdate ? Icons.hourglass_top : Icons.refresh, size: 16),
            label: Text(_checkingUpdate ? 'Memeriksa…' : 'Periksa'),
          ),
        ]),
        if (_downloadProgress != null) ...[
          const SizedBox(height: Space.md),
          LinearProgressIndicator(value: _downloadProgress),
          const SizedBox(height: 4),
          Text('Mengunduh pembaruan… ${((_downloadProgress ?? 0) * 100).toInt()}%', style: TextStyle(color: muted, fontSize: 12)),
        ],
      ])),
      const SizedBox(height: Space.xl),
      const ScreenHeader('Tes scanner barcode', 'Coba arahkan scanner ke barcode apa saja untuk memastikan terbaca.', section: true),
      const _ScannerTestPanel(),
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
        RemoteAccessSection(api: widget.api),
        const SizedBox(height: Space.xl),
        const ScreenHeader('Zona berbahaya', 'Tindakan permanen yang tidak bisa dibatalkan.', section: true),
        Container(
          padding: const EdgeInsets.all(Space.lg),
          decoration: BoxDecoration(color: surface, border: Border.all(color: errorColor.withValues(alpha: 0.5)), borderRadius: BorderRadius.circular(Corners.panel)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Hapus transaksi hari ini', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: Space.xs),
            Text('Untuk membersihkan transaksi tes atau salah input. Stoknya dikembalikan; bon yang sudah dibayar sebagian dilewati.', style: TextStyle(color: muted)),
            const SizedBox(height: Space.md),
            Align(alignment: Alignment.centerLeft, child: OutlinedButton.icon(onPressed: purgeToday,
              style: OutlinedButton.styleFrom(foregroundColor: errorColor), icon: const Icon(Icons.delete_sweep_outlined), label: const Text('Hapus transaksi hari ini'))),
            const Divider(height: Space.xxl),
            const Text('Hapus riwayat transaksi', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: Space.xs),
            Text('Hapus semua transaksi sebelum tanggal tertentu, termasuk bon yang belum lunas. Stok tidak berubah.', style: TextStyle(color: muted)),
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
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: load, children: [
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

class _ScannerTestPanel extends StatefulWidget {
  const _ScannerTestPanel();
  @override State<_ScannerTestPanel> createState() => _ScannerTestPanelState();
}

class _ScannerTestPanelState extends State<_ScannerTestPanel> {
  final _scanner = BarcodeBurst();
  final _manual = TextEditingController();
  String? _lastCode;
  DateTime? _lastTime;

  @override
  void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(_onKey);
  }

  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_onKey);
    _manual.dispose();
    super.dispose();
  }

  bool _onKey(KeyEvent event) {
    if (!mounted || ModalRoute.of(context)?.isCurrent == false) return false;
    if (FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null) return false;
    final res = _scanner.feed(event);
    if (res.code != null) {
      setState(() {
        _lastCode = res.code;
        _lastTime = DateTime.now();
      });
      return true;
    }
    return false;
  }

  Future<void> _scanCamera() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (code != null && mounted) {
      setState(() {
        _lastCode = code;
        _lastTime = DateTime.now();
      });
    }
  }

  @override
  Widget build(BuildContext context) => WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Row(children: [
      Expanded(child: TextField(
        controller: _manual,
        onSubmitted: (v) {
          if (v.trim().isEmpty) return;
          setState(() {
            _lastCode = v.trim();
            _lastTime = DateTime.now();
            _manual.clear();
          });
        },
        decoration: const InputDecoration(
          hintText: 'Klik di luar atau di sini lalu scan barcode…',
          prefixIcon: Icon(Icons.qr_code_scanner, size: 20),
        ),
      )),
      if (!isDesktop) ...[
        const SizedBox(width: Space.sm),
        OutlinedButton.icon(onPressed: _scanCamera, icon: const Icon(Icons.camera_alt_outlined, size: 18), label: const Text('Kamera')),
      ],
    ]),
    const SizedBox(height: Space.sm),
    Text(
      _lastCode == null
          ? 'Belum ada barcode yang dibaca.'
          : 'Terakhir dibaca: $_lastCode (${timeText(_lastTime!)})',
      style: TextStyle(
        fontFamily: _lastCode == null ? null : monoFamily,
        color: _lastCode == null ? muted : successColor,
        fontWeight: _lastCode == null ? FontWeight.w400 : FontWeight.w600,
      ),
    ),
  ]));
}
