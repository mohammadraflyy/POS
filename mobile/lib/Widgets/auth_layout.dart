import 'dart:async';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import 'ui.dart' show BrandMark;

/// Sign-in and lock screens: a rotating banner on the left, the form on the right.
/// Below [splitWidth] the banner is dropped and the form fills the screen.
class AuthLayout extends StatelessWidget {
  const AuthLayout({super.key, required this.child});
  final Widget child;
  static const splitWidth = 900.0;

  @override
  Widget build(BuildContext context) => Scaffold(body: LayoutBuilder(builder: (context, box) {
    final form = SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 440),
      child: SingleChildScrollView(padding: const EdgeInsets.all(Space.xl), child: child))));
    if (box.maxWidth < splitWidth) return form;
    return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Expanded(flex: 11, child: AuthBanner()),
      Expanded(flex: 9, child: form),
    ]);
  }));
}

class _Slide {
  const _Slide(this.icon, this.title, this.body);
  final IconData icon;
  final String title, body;
}

/// Feature slides that advance on their own every few seconds; the dots jump to one.
class AuthBanner extends StatefulWidget {
  const AuthBanner({super.key});
  static const slides = [
    _Slide(Icons.point_of_sale_rounded, 'Kasir cepat, cukup keyboard', 'Scan barcode, PageUp/PageDown pindah panel, End untuk bayar. Tangan tidak perlu lepas dari keyboard.'),
    _Slide(Icons.inventory_2_outlined, 'Stok & harga selalu terkini', 'Pembelian langsung menambah stok dan menghitung ulang HPP rata-rata per satuan.'),
    _Slide(Icons.insights_rounded, 'Rekap harian dalam satu layar', 'Omzet, laba, bon dan kas keluar siap dicek sebelum tutup toko.'),
  ];
  @override
  State<AuthBanner> createState() => _AuthBannerState();
}

class _AuthBannerState extends State<AuthBanner> {
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 6), (_) => setState(() => _index = (_index + 1) % AuthBanner.slides.length));
  }

  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final slide = AuthBanner.slides[_index];
    // The banner stays the light-mode blue in both themes so its white text keeps its contrast.
    return Container(
      color: Palette.light.primaryInk,
      padding: const EdgeInsets.all(Space.xxl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [BrandMark(size: 30), SizedBox(width: Space.md),
          Text('Point of Sales', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600))]),
        const Spacer(),
        AnimatedSwitcher(duration: Motion.enter * 2, child: Column(key: ValueKey(_index), crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 56, height: 56, decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(Corners.panel)),
            child: Icon(slide.icon, color: Colors.white, size: 28)),
          const SizedBox(height: Space.xl),
          Text(slide.title, style: const TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w700, height: 1.2)),
          const SizedBox(height: Space.md),
          ConstrainedBox(constraints: const BoxConstraints(maxWidth: 460),
            child: Text(slide.body, style: TextStyle(color: Colors.white.withValues(alpha: 0.72), fontSize: 15, height: 1.5))),
        ])),
        const SizedBox(height: Space.xl),
        Row(children: [
          for (var i = 0; i < AuthBanner.slides.length; i++)
            GestureDetector(onTap: () => setState(() => _index = i), child: AnimatedContainer(duration: Motion.enter,
              margin: const EdgeInsets.only(right: 8), width: i == _index ? 28 : 8, height: 8,
              decoration: BoxDecoration(color: i == _index ? Colors.white : Colors.white.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(4)))),
        ]),
        const Spacer(),
        Text('Data tersimpan di PC toko, tetap jalan tanpa internet.', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12)),
      ]),
    );
  }
}
