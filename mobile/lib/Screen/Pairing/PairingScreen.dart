import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../services/mobile_api.dart';
import '../../state/app_state.dart';
import '../../Widgets/ui.dart';
import 'ScanScreen.dart';
import '../../Widgets/admin.dart' show isDesktop;
class PairingScreen extends StatefulWidget {
  const PairingScreen({super.key, required this.app});
  final AppState app;
  @override
  State<PairingScreen> createState() => _PairingScreenState();
}
class _PairingScreenState extends State<PairingScreen> {
  // on the shop PC the server is local and there is no camera: sign in with an account
  final _host = TextEditingController(text: isDesktop ? '127.0.0.1:48950' : '');
  final _code = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController(text: isDesktop ? 'PC Kasir' : 'Kasir Mobile');
  bool _login = isDesktop;
  bool _obscure = true;
  bool _scanning = false;
  bool _manual = false, _scanned = false;
  String? _error;
  @override
  void dispose() { for (final c in [_host, _code, _username, _password, _name]) { c.dispose(); } super.dispose(); }
  Future<void> _connect() async {
    setState(() => _error = null);
    try {
      await widget.app.connect(host: _host.text, code: _code.text.trim(),
        username: _username.text, password: _password.text, deviceName: _name.text);
      if (mounted) _password.clear();
    } catch (e) { if (mounted) { setState(() => _error = e.toString()); showError(context, e); } }
  }
  Future<void> _signIn() async {
    setState(() => _error = null);
    try {
      await widget.app.login(host: _host.text, username: _username.text, password: _password.text, deviceName: _name.text);
      if (mounted) _password.clear();
    } catch (e) { if (mounted) { setState(() => _error = e.toString()); showError(context, e); } }
  }
  Future<void> _scan() async {
    if (_scanning || widget.app.busy) return;
    setState(() => _scanning = true);
    try {
      final result = await Navigator.of(context).push<String>(MaterialPageRoute(
        builder: (_) => const ScanScreen(title: 'Scan QR pairing PC', qrOnly: true)));
      if (!mounted || result == null) return;
      final qr = PairingQr.parse(result);
      setState(() { _host.text = qr.address; _code.text = qr.code; _scanned = true; _manual = false; });
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }
  @override
  Widget build(BuildContext context) => Scaffold(body: SafeArea(child: LayoutBuilder(builder: (context, box) {
    final form = Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: SingleChildScrollView(
      padding: const EdgeInsets.all(Space.xl), child: AutofillGroup(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [BrandMark(size: 28), SizedBox(width: Space.md), Text('Point of Sales', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500))]), const SizedBox(height: Space.xxl),
        Text(_login ? 'Masuk ke toko' : 'Hubungkan ke toko', style: Theme.of(context).textTheme.headlineLarge),
        const SizedBox(height: 12), Text(_login
          ? 'Masuk dengan akun toko. Di PC kasir, alamat server biasanya 127.0.0.1:48950.'
          : 'Hubungkan perangkat ke PC toko untuk mulai. Pastikan keduanya menggunakan jaringan yang sama.', style: const TextStyle(color: muted)),
        const SizedBox(height: 24),
        if (!_login) ...[
        if (!isDesktop) OutlinedButton.icon(onPressed: widget.app.busy || _scanning ? null : _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan QR dari PC')),
        if (_scanned && !_manual) const Padding(padding: EdgeInsets.only(top: 14), child: Pill('PC siap dihubungkan • silakan login', icon: Icons.check_circle_outline)),
        if (!isDesktop) TextButton(onPressed: widget.app.busy ? null : () => setState(() => _manual = !_manual), child: Text(_manual ? 'Sembunyikan input manual' : 'Masukkan alamat / kode secara manual')),
        ],
        if (_manual || _login || isDesktop) ...[
        const SizedBox(height: Space.lg), TextField(controller: _host, enabled: !widget.app.busy, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Alamat server', hintText: '192.168.1.5:48950', prefixIcon: Icon(Icons.computer))),
        if (!_login) ...[const SizedBox(height: Space.lg), TextField(controller: _code, enabled: !widget.app.busy, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: 'Kode pairing', counterText: '', prefixIcon: Icon(Icons.pin_outlined)))],
        ],
        const SizedBox(height: Space.lg), TextField(controller: _username, textInputAction: TextInputAction.next, enabled: !widget.app.busy, autofillHints: const [AutofillHints.username], decoration: InputDecoration(labelText: _login ? 'Username' : 'Username kasir', prefixIcon: const Icon(Icons.person_outline))),
        const SizedBox(height: Space.lg), TextField(controller: _password, autofillHints: const [AutofillHints.password], textInputAction: TextInputAction.next, enabled: !widget.app.busy, obscureText: _obscure, autocorrect: false, enableSuggestions: false, decoration: InputDecoration(labelText: 'Password', prefixIcon: const Icon(Icons.lock_outline), suffixIcon: IconButton(tooltip: _obscure ? 'Tampilkan password' : 'Sembunyikan password', onPressed: () => setState(() => _obscure = !_obscure), icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined)))),
        const SizedBox(height: Space.lg), TextField(controller: _name, textInputAction: TextInputAction.done, onSubmitted: (_) { if (!widget.app.busy) { _login ? _signIn() : _connect(); } }, enabled: !widget.app.busy, decoration: const InputDecoration(labelText: 'Nama perangkat')),
        if (_error != null || widget.app.notice != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_error ?? widget.app.notice!, style: const TextStyle(color: errorColor))),
        const SizedBox(height: Space.xl), SizedBox(width: double.infinity, child: FilledButton(onPressed: widget.app.busy ? null : (_login ? _signIn : _connect), child: widget.app.busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(_login ? 'Masuk' : 'Hubungkan perangkat'))),
        SizedBox(width: double.infinity, child: TextButton(onPressed: widget.app.busy ? null : () => setState(() { _login = !_login; _error = null; }),
          child: Text(_login ? 'Hubungkan dengan kode pairing' : 'Masuk dengan akun (tanpa kode pairing)'))),
        if (widget.app.hasStoredSession) SizedBox(width: double.infinity, child: TextButton(onPressed: widget.app.busy ? null : widget.app.restore, child: const Text('Coba koneksi tersimpan kembali'))),
        const SizedBox(height: 12), SizedBox(width: double.infinity, child: TextButton(onPressed: widget.app.busy ? null : widget.app.startDemo, child: const Text('Coba tampilan kasir • Mode demo'))),
        const Text('Demo memakai data contoh. Transaksi tidak dikirim ke toko dan hilang saat demo dimulai ulang.', textAlign: TextAlign.center, style: TextStyle(color: muted, fontSize: 13)),
      ])),
    )));
    return form;
  })));
}
