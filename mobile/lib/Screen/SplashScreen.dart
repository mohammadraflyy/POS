import 'package:flutter/material.dart';
import '../core/theme.dart';
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(backgroundColor: wine, body: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
    Icon(Icons.storefront_rounded, size: 86, color: Colors.white), SizedBox(height: Space.xl),
    Text('Point of Sales', style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w600)),
    SizedBox(height: 32), CircularProgressIndicator(color: Colors.white),
  ])));
}
