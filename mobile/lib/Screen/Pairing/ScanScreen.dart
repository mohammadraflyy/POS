import 'dart:async';
import '../../Widgets/ui.dart';
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, this.title = 'Scan barcode', this.qrOnly = false});
  final String title;
  final bool qrOnly;

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> with WidgetsBindingObserver {
  late final MobileScannerController _controller;
  Future<void> _operations = Future<void>.value();
  bool _done = false;
  bool _closed = false;
  bool _working = false;
  bool _wantRunning = true;
  CameraFacing _facing = CameraFacing.back;
  Object? _operationError;

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController(
      autoStart: false,
      facing: CameraFacing.back,
      detectionSpeed: DetectionSpeed.noDuplicates,
      formats: widget.qrOnly ? const [BarcodeFormat.qrCode] : const [],
      returnImage: false,
      autoZoom: false,
    );
    WidgetsBinding.instance.addObserver(this);
    // Attach the preview widget before starting the native camera.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_closed) unawaited(_syncCamera());
    });
  }

  // Serialize native start/stop operations so resume/retry cannot start twice.
  Future<void> _syncCamera({bool restart = false}) {
    _operations = _operations.then((_) async {
      if (_closed) return;
      if (mounted) setState(() => _working = true);
      try {
        if (restart && _controller.value.isRunning) await _controller.stop();
        if (_closed) return;
        if (_wantRunning && !_done) {
          if (!_controller.value.isRunning) {
            await _controller.start(cameraDirection: _facing);
          }
          // A permission dialog can change lifecycle while start() is pending.
          final lifecycle = WidgetsBinding.instance.lifecycleState;
          if (!_closed && lifecycle != null && lifecycle != AppLifecycleState.resumed) {
            _wantRunning = false;
            if (_controller.value.isRunning) await _controller.stop();
          }
        } else if (_controller.value.isRunning) {
          await _controller.stop();
        }
      } catch (error) {
        if (mounted && !_closed) setState(() => _operationError = error);
      } finally {
        if (mounted && !_closed) setState(() => _working = false);
      }
    });
    return _operations;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_closed || _done) return;
    // Do not re-enter start/stop while the OS permission dialog is active.
    if (!_controller.value.hasCameraPermission) return;
    _wantRunning = state == AppLifecycleState.resumed;
    unawaited(_syncCamera());
  }

  void _retry({bool changeCamera = false}) {
    if (_working || _closed || _done) return;
    setState(() {
      _working = true;
      _operationError = null;
      _wantRunning = true;
      if (changeCamera) {
        _facing = _facing == CameraFacing.back ? CameraFacing.front : CameraFacing.back;
      }
    });
    unawaited(_syncCamera(restart: true));
  }

  Future<void> _detected(BarcodeCapture capture) async {
    if (_done || _closed) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null || raw.isEmpty) continue;
      _done = true; // Ignore repeated frames before navigating away.
      _wantRunning = false;
      await HapticFeedback.mediumImpact();
      SystemSound.play(SystemSoundType.click);
      await _syncCamera();
      if (mounted && !_closed) Navigator.of(context).pop(raw);
      return;
    }
  }

  String _details(Object error) {
    if (error is MobileScannerException) {
      final details = error.errorDetails;
      return [
        'Scanner: ${error.errorCode.name}',
        if (details?.code != null) 'Native code: ${details!.code}',
        if (details?.message != null) 'Message: ${details!.message}',
        if (details?.details != null) 'Details: ${details!.details}',
      ].join('\n');
    }
    if (error is PlatformException) {
      return 'Platform: ${error.code}\n${error.message ?? ''}\n${error.details ?? ''}';
    }
    return '${error.runtimeType}: $error';
  }

  Widget _errorPanel(Object error) {
    final permissionDenied = error is MobileScannerException &&
        error.errorCode == MobileScannerErrorCode.permissionDenied;
    final missingPlugin = error is MissingPluginException;
    final details = _details(error);
    return ColoredBox(color: const Color(0xFF211D24), child: Center(
      child: SingleChildScrollView(padding: const EdgeInsets.all(Space.xl), child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(permissionDenied ? Icons.no_photography_outlined : Icons.videocam_off_outlined,
            color: Colors.white, size: 56),
          const SizedBox(height: Space.lg),
          Text(permissionDenied ? 'Akses kamera belum diizinkan' : 'Kamera belum dapat dibuka',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          Text(permissionDenied
            ? 'Buka Pengaturan HP → Aplikasi → POS → Izin → Kamera. Izinkan akses, lalu kembali dan tekan Coba lagi.'
            : missingPlugin
              ? 'Plugin kamera belum terpasang pada aplikasi ini. Hentikan aplikasi, build ulang, lalu pasang hasil build terbaru.'
              : 'Pastikan akses kamera HP aktif dan tutup aplikasi lain yang memakai kamera. Tekan Coba lagi atau coba kamera lainnya.',
            textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: Space.lg),
          Container(width: double.infinity, padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(12)),
            child: SelectableText(details, style: const TextStyle(color: Colors.white70, fontSize: 13))),
          const SizedBox(height: 16),
          Wrap(alignment: WrapAlignment.center, spacing: 10, runSpacing: 10, children: [
            FilledButton.icon(onPressed: _working ? null : () => _retry(),
              icon: const Icon(Icons.refresh), label: Text(_working ? 'Membuka kamera…' : 'Coba lagi')),
            if (!permissionDenied && !missingPlugin)
              FilledButton.tonal(onPressed: _working ? null : () => _retry(changeCamera: true),
                child: Text(_facing == CameraFacing.back ? 'Coba kamera depan' : 'Coba kamera belakang')),
            TextButton.icon(onPressed: () async {
              await Clipboard.setData(ClipboardData(text: details));
              if (mounted) showNotice(context, 'Detail error kamera disalin.', kind: NoticeKind.success);
            }, icon: const Icon(Icons.copy, color: Colors.white),
              label: const Text('Salin detail error', style: TextStyle(color: Colors.white))),
          ]),
          TextButton(onPressed: () => Navigator.of(context).pop(),
            child: const Text('Kembali • gunakan input manual', style: TextStyle(color: Colors.white))),
        ]),
      )),
    ));
  }

  @override
  void dispose() {
    _closed = true;
    _wantRunning = false;
    WidgetsBinding.instance.removeObserver(this);
    // Wait for a pending native operation before releasing the controller.
    unawaited(_operations.then((_) async {
      try { await _controller.dispose(); } catch (_) { /* Route already closed. */ }
    }));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.title),
      actions: [
        IconButton(
          tooltip: 'Nyalakan/matikan lampu senter',
          icon: const Icon(Icons.flashlight_on_outlined),
          onPressed: () => _controller.toggleTorch(),
        ),
        IconButton(
          tooltip: 'Ganti kamera depan/belakang',
          icon: const Icon(Icons.flip_camera_android),
          onPressed: _working || _done ? null : () => _retry(changeCamera: true),
        ),
        const SizedBox(width: Space.xs),
      ],
    ),
    backgroundColor: const Color(0xFF211D24),
    body: ValueListenableBuilder<MobileScannerState>(
      valueListenable: _controller,
      builder: (context, state, _) {
        final error = _operationError ?? state.error;
        return NoticeListener(kind: NoticeKind.error, message: error == null ? null : 'Kamera belum dapat digunakan. Periksa izin kamera atau gunakan input manual.\n${_details(error)}', child: Stack(fit: StackFit.expand, children: [
          MobileScanner(
            controller: _controller,
            onDetect: _detected,
            errorBuilder: (context, error) => _errorPanel(error),
          ),
          if (error != null) _errorPanel(error)
          else ...[
            if (_working || !state.isRunning)
              const Center(child: CircularProgressIndicator(color: Colors.white)),
            Positioned(top: 16, right: 16, child: SafeArea(
              child: FilledButton.tonalIcon(
                onPressed: _working || !state.isRunning || _done
                    ? null
                    : () => _retry(changeCamera: true),
                icon: const Icon(Icons.flip_camera_android),
                label: Text(_facing == CameraFacing.back
                    ? 'Kamera depan'
                    : 'Kamera belakang'),
              ),
            )),
            Align(alignment: Alignment.bottomCenter, child: SafeArea(child: Padding(
              padding: const EdgeInsets.all(Space.xl), child: DecoratedBox(
                decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(16)),
                child: Padding(padding: const EdgeInsets.all(16), child: Text(
                  widget.qrOnly ? 'Arahkan kamera ke QR pairing pada PC.' : 'Arahkan kamera ke barcode produk.',
                  style: const TextStyle(color: Colors.white), textAlign: TextAlign.center)),
              ),
            ))),
          ],
        ]));
      },
    ),
  );
}
