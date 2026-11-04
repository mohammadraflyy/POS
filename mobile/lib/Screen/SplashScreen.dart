import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../Widgets/ui.dart';

/// While the app (and on a PC, its server) starts: the mark and the name on the ground.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(backgroundColor: canvas, body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    BrandMark(size: 44), SizedBox(height: Space.lg),
    Text('Point of Sales', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
    SizedBox(height: Space.xl),
    SizedBox(width: 120, child: LinearProgressIndicator(minHeight: 2)),
  ])));
}
