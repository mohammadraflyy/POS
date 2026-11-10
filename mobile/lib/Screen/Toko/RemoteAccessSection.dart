import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/theme.dart';
import '../../services/store_api.dart';
import '../../services/windows_startup.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';

/// Access from outside the shop (admin): phones keep working away from the shop's Wi-Fi,
/// through the shop's own Tailscale network built into the app. The owner pastes the
/// shop's Tailscale "kunci admin" once; every phone that pairs afterwards gets its own
/// way in by itself.
class RemoteAccessSection extends StatefulWidget {
  const RemoteAccessSection({super.key, required this.api, this.startup = const WindowsStartup()});
  final StoreApi api;
  final WindowsStartup startup;
  @override State<RemoteAccessSection> createState() => _RemoteAccessSectionState();
}

class _RemoteAccessSectionState extends State<RemoteAccessSection> {
  Map<String, dynamic>? status;
  String? error;
  bool? startsWithPc;
  Timer? _poll;

  @override void initState() { super.initState(); load(); loadStartup(); }
  @override void dispose() { _poll?.cancel(); super.dispose(); }

  Future<void> load() async {
    try {
      final s = await widget.api.remoteAccess();
      if (!mounted) return;
      setState(() { status = s; error = null; });
      // while the PC is still joining, look again soon
      _poll?.cancel();
      if (s['state'] == 'starting') _poll = Timer(const Duration(seconds: 3), load);
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }

  Future<void> loadStartup() async {
    if (!widget.startup.supported) return;
    try {
      final enabled = await widget.startup.isEnabled();
      if (mounted) setState(() => startsWithPc = enabled);
    } catch (_) {}
  }

  Future<void> setStartup(bool enabled) async {
    if (await runAction(context, () => widget.startup.setEnabled(enabled),
      success: enabled ? 'Aplikasi akan terbuka saat PC menyala.' : 'Aplikasi tidak lagi terbuka otomatis.')) {
      if (mounted) setState(() => startsWithPc = enabled);
    }
  }

  Future<void> setUp() async {
    final saved = await showDialog<bool>(context: context, builder: (_) => _SetupDialog(api: widget.api));
    if (saved == true && mounted) { showNotice(context, 'Akses dari luar toko diaktifkan.', kind: NoticeKind.success); load(); }
  }

  Future<void> turnOff() async {
    if (!await confirmAction(context, title: 'Matikan akses dari luar toko?', destructive: true, confirmLabel: 'Matikan',
      message: 'HP tidak bisa lagi tersambung dari luar toko. Di Wi-Fi toko semuanya tetap berjalan. '
        'Untuk menyalakannya lagi, kunci admin Tailscale perlu ditempel ulang.')) { return; }
    if (mounted && await runAction(context, widget.api.disableRemote, success: 'Akses dari luar toko dimatikan.')) load();
  }

  String _stateLabel(Map<String, dynamic> s) => switch (s['state']) {
    'online' => 'Aktif',
    'starting' => 'Menyambung…',
    'failed' => 'Bermasalah',
    _ => s['configured'] == true ? 'Menyambung…' : 'Mati',
  };

  @override Widget build(BuildContext context) {
    final s = status;
    final configured = s?['configured'] == true;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      ScreenHeader('Akses dari luar toko', 'HP tetap bisa dipakai di luar toko lewat internet, tanpa aplikasi tambahan di HP.', section: true, actions: [
        if (s != null && s['available'] == true && !configured) FilledButton.icon(onPressed: setUp, icon: const Icon(Icons.public), label: const Text('Aktifkan')),
      ]),
      WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (error != null) Text(error!, style: TextStyle(color: errorColor))
        else if (s == null) Text('Memuat…', style: TextStyle(color: muted))
        else if (s['available'] != true) Text('Versi aplikasi ini belum menyertakan komponen akses dari luar toko. Pasang installer versi terbaru di PC toko.', style: TextStyle(color: muted))
        else ...[
          SummaryRow('Status', _stateLabel(s)),
          if (s['address'] != null) SummaryRow('Alamat Tailscale PC', s['address'].toString()),
          if (s['message'] != null && s['state'] != 'online') Padding(padding: const EdgeInsets.only(top: Space.xs),
            child: Text(s['message'].toString(), style: TextStyle(color: s['state'] == 'failed' ? errorColor : muted, fontSize: 13))),
          const SizedBox(height: Space.sm),
          Text(configured
            ? 'HP yang sudah tersambung lewat Wi-Fi toko otomatis disiapkan untuk dipakai dari luar. PC ini harus tetap menyala dan aplikasinya terbuka.'
            : 'Perlu akun Tailscale gratis milik toko. Panduannya muncul setelah menekan Aktifkan.', style: TextStyle(color: muted, fontSize: 13)),
          if (configured) ...[
            const SizedBox(height: Space.md),
            Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
              OutlinedButton.icon(onPressed: load, icon: const Icon(Icons.sync, size: 18), label: const Text('Periksa')),
              OutlinedButton.icon(onPressed: setUp, icon: const Icon(Icons.key_outlined, size: 18), label: const Text('Ganti kunci admin')),
              OutlinedButton.icon(onPressed: turnOff, style: OutlinedButton.styleFrom(foregroundColor: errorColor), icon: const Icon(Icons.public_off, size: 18), label: const Text('Matikan')),
            ]),
          ],
        ],
        if (startsWithPc != null) ...[
          const Divider(height: Space.xxl),
          SwitchListTile(contentPadding: EdgeInsets.zero, value: startsWithPc!, onChanged: setStartup,
            title: const Text('Buka otomatis saat PC menyala'),
            subtitle: Text('Supaya kasir di HP tidak menunggu PC dibuka. Matikan juga mode tidur (sleep) di pengaturan Windows.', style: TextStyle(color: muted, fontSize: 13))),
        ],
      ])),
    ]);
  }
}

/// The once-only setup, step by step: a Tailscale account, the `pos` tag, the OAuth
/// client ("kunci admin"), then paste. The server checks the key before saving it.
class _SetupDialog extends StatefulWidget {
  const _SetupDialog({required this.api});
  final StoreApi api;
  @override State<_SetupDialog> createState() => _SetupDialogState();
}

class _SetupDialogState extends State<_SetupDialog> {
  final clientId = TextEditingController(), clientSecret = TextEditingController();
  bool saving = false;
  String? error;

  static const tagPolicy = '"tagOwners": {\n  "tag:pos": ["autogroup:admin"]\n}';

  @override void dispose() { clientId.dispose(); clientSecret.dispose(); super.dispose(); }

  Future<void> save() async {
    if (clientId.text.trim().isEmpty || clientSecret.text.trim().isEmpty) {
      setState(() => error = 'Tempel Client ID dan Client Secret.');
      return;
    }
    setState(() { saving = true; error = null; });
    try {
      await widget.api.enableRemote(clientId.text.trim(), clientSecret.text.trim());
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { error = e.toString(); saving = false; });
    }
  }

  Widget _step(int number, String title, String body, {String? url, String? copy}) => Padding(
    padding: const EdgeInsets.only(bottom: Space.lg),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(width: 24, height: 24, alignment: Alignment.center, decoration: BoxDecoration(color: activePill, shape: BoxShape.circle),
        child: Text('$number', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: ink))),
      const SizedBox(width: Space.md),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: ink)),
        const SizedBox(height: 2),
        Text(body, style: TextStyle(color: muted, fontSize: 13)),
        if (copy != null) Container(
          margin: const EdgeInsets.only(top: Space.sm), padding: const EdgeInsets.all(Space.sm), width: double.infinity,
          decoration: BoxDecoration(color: canvas, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(6)),
          child: SelectableText(copy, style: TextStyle(fontFamily: monoFamily, fontSize: 12, color: ink))),
        Wrap(spacing: Space.sm, children: [
          if (url != null) TextButton.icon(onPressed: () => openInBrowser(url), icon: const Icon(Icons.open_in_new, size: 16), label: const Text('Buka halaman')),
          if (copy != null) TextButton.icon(onPressed: () => Clipboard.setData(ClipboardData(text: copy)), icon: const Icon(Icons.copy, size: 16), label: const Text('Salin')),
        ]),
      ])),
    ]));

  @override Widget build(BuildContext context) => AlertDialog(
    title: const Text('Aktifkan akses dari luar toko'),
    content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Dilakukan sekali saja, sekitar 3 menit. HP tidak perlu memasang apa pun.', style: TextStyle(color: muted)),
      const SizedBox(height: Space.lg),
      _step(1, 'Buat akun Tailscale toko', 'Masuk dengan akun Google toko. Akun baru langsung dibuat, gratis.',
        url: 'https://login.tailscale.com/start'),
      _step(2, 'Buat tag "pos"', 'Di Access controls, tambahkan tag pos dengan pemilik autogroup:admin. '
        'Kalau memakai editor teks (JSON), tempel baris ini di dalam kurung kurawal paling luar, lalu Save.',
        url: 'https://login.tailscale.com/admin/acls', copy: tagPolicy),
      _step(3, 'Buat kunci admin', 'Di Settings → OAuth clients, tekan Generate OAuth client. Centang Keys → Auth Keys: Write, '
        'pilih tag tag:pos, lalu Generate. Salin Client ID dan Client Secret.',
        url: 'https://login.tailscale.com/admin/settings/oauth'),
      _step(4, 'Tempel di sini', 'Client Secret hanya ditampilkan sekali oleh Tailscale.'),
      TextField(controller: clientId, enabled: !saving, decoration: const InputDecoration(labelText: 'Client ID')),
      const SizedBox(height: Space.md),
      TextField(controller: clientSecret, enabled: !saving, obscureText: true, decoration: const InputDecoration(labelText: 'Client Secret', hintText: 'tskey-client-…')),
      if (error != null) Padding(padding: const EdgeInsets.only(top: Space.md), child: Text(error!, style: TextStyle(color: errorColor))),
    ]))),
    actions: [
      TextButton(onPressed: saving ? null : () => Navigator.pop(context, false), child: const Text('Batal')),
      FilledButton(onPressed: saving ? null : save, child: Text(saving ? 'Memeriksa kunci…' : 'Simpan & sambungkan')),
    ],
  );
}
