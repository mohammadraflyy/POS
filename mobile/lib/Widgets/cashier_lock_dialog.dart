import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../services/mobile_api.dart';
import '../state/app_state.dart';

/// Shows a non-dismissible lock screen dialog that secures the cashier session.
/// The dialog cannot be closed by tapping the barrier or pressing Back/Escape.
/// It requires entering the current user's password to unlock, or choosing
/// "Ganti Akun / Keluar" to return to the sign-in screen.
Future<bool?> showCashierLockDialog(
  BuildContext context, {
  required AppState app,
  required String shopName,
}) {
  return showDialog<bool>(
    context: context,
    barrierDismissible: false,
    barrierColor: Colors.black.withValues(alpha: 0.72),
    builder: (context) => PopScope(
      canPop: false,
      child: CashierLockDialog(app: app, shopName: shopName),
    ),
  );
}

class CashierLockDialog extends StatefulWidget {
  const CashierLockDialog({
    super.key,
    required this.app,
    required this.shopName,
  });

  final AppState app;
  final String shopName;

  @override
  State<CashierLockDialog> createState() => _CashierLockDialogState();
}

class _CashierLockDialogState extends State<CashierLockDialog> {
  final TextEditingController _password = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  bool _obscure = true;
  bool _verifying = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _password.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_verifying) return;
    final pwd = _password.text;
    if (!widget.app.isDemo && pwd.isEmpty) {
      setState(() => _error = 'Masukkan password akun kasir.');
      _focusNode.requestFocus();
      return;
    }

    setState(() {
      _verifying = true;
      _error = null;
    });

    try {
      final ok = await widget.app.verifyAndUnlock(pwd);
      if (ok) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) {
          setState(() => _error = 'Password tidak cocok. Silakan coba lagi.');
          _password.clear();
          _focusNode.requestFocus();
        }
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiFailure ? e.message : 'Password salah atau server tidak dapat dihubungi.';
        setState(() => _error = msg);
        _password.clear();
        _focusNode.requestFocus();
      }
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  Future<void> _confirmLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Keluar dari Akun?'),
        content: Text(
          'Sesi kasir atas nama "${widget.app.userName}" akan ditutup dan Anda akan kembali ke halaman login.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: errorColor),
            child: const Text('Keluar'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      await widget.app.logout();
      if (mounted) {
        Navigator.of(context).pop(false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final displayName = widget.app.userName.isEmpty ? 'Kasir' : widget.app.userName;
    final role = widget.app.role == 'admin' ? 'Admin' : 'Kasir';
    final cardBg = isDark ? const Color(0xFF1E293B) : Colors.white;
    final borderCol = isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0);
    final userTileBg = isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC);

    return Dialog(
      backgroundColor: cardBg,
      elevation: 12,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Corners.dialog),
        side: BorderSide(color: borderCol),
      ),
      insetPadding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.xl),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400),
        child: Padding(
          padding: const EdgeInsets.all(Space.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isDark ? const Color(0xFF0F172A) : const Color(0xFFEFF6FF),
                    border: Border.all(
                      color: isDark ? const Color(0xFF38BDF8) : const Color(0xFF3B82F6),
                      width: 1.5,
                    ),
                  ),
                  child: Icon(
                    Icons.lock_rounded,
                    size: 28,
                    color: isDark ? const Color(0xFF38BDF8) : const Color(0xFF2563EB),
                  ),
                ),
              ),
              const SizedBox(height: Space.md),
              const Center(
                child: Text(
                  'Kasir Terkunci',
                  style: TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Center(
                child: Text(
                  'Sesi dikunci untuk keamanan saat kasir istirahat.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: muted),
                ),
              ),
              const SizedBox(height: Space.lg),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: userTileBg,
                  borderRadius: BorderRadius.circular(Corners.control),
                  border: Border.all(color: borderCol),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0),
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                          ),
                          Text(
                            '${widget.shopName} · $role',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12, color: muted),
                          ),
                        ],
                      ),
                    ),
                    if (widget.app.isDemo)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: pillWarningBg,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'Demo',
                          style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: pillWarningInk),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: Space.lg),
              TextField(
                controller: _password,
                focusNode: _focusNode,
                obscureText: _obscure,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  labelText: 'Password Akun Kasir',
                  hintText: widget.app.isDemo ? 'Mode demo: bebas' : 'Masukkan password...',
                  prefixIcon: const Icon(Icons.key_outlined, size: 20),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                      size: 20,
                    ),
                    tooltip: _obscure ? 'Tampilkan password' : 'Sembunyikan password',
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: Space.sm),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF450A0A) : const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: isDark ? const Color(0xFF991B1B) : const Color(0xFFFECACA),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.error_outline, size: 16, color: errorColor),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _error!,
                          style: TextStyle(color: errorColor, fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: Space.xl),
              FilledButton.icon(
                onPressed: _verifying ? null : _submit,
                icon: _verifying
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.lock_open_rounded, size: 18),
                label: Text(_verifying ? 'Memverifikasi…' : 'Buka Kunci Kasir'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(double.infinity, 44),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Corners.control),
                  ),
                ),
              ),
              const SizedBox(height: Space.sm),
              TextButton.icon(
                onPressed: _verifying ? null : _confirmLogout,
                icon: const Icon(Icons.logout_rounded, size: 16),
                label: const Text('Ganti Akun / Keluar'),
                style: TextButton.styleFrom(
                  foregroundColor: muted,
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

