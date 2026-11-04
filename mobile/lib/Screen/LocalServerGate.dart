import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../services/local_server.dart';
import 'SplashScreen.dart';

/// On the shop PC the app is also the server. This holds the app back until the server is
/// up (importing the old desktop app's data on first run), and explains plainly when it
/// cannot start - usually because the old POS Desktop is still open.
class LocalServerGate extends StatefulWidget {
  const LocalServerGate({super.key, required this.child, this.start = startLocalServer});
  final Widget child;
  final Future<LocalServerResult> Function() start;
  @override
  State<LocalServerGate> createState() => _LocalServerGateState();
}

class _LocalServerGateState extends State<LocalServerGate> {
  LocalServerResult? _result;

  @override
  void initState() { super.initState(); _start(); }

  Future<void> _start() async {
    setState(() => _result = null);
    final result = await widget.start();
    if (mounted) setState(() => _result = result);
  }

  @override
  Widget build(BuildContext context) => switch (_result) {
    null => MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(), home: const SplashScreen()),
    LocalServerReady() => widget.child,
    LocalServerFailed(:final message) => MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(), home: Scaffold(
      body: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: Padding(
        padding: const EdgeInsets.all(Space.xl),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.dns_outlined, size: 32, color: muted), const SizedBox(height: Space.lg),
          Text('Server toko belum bisa dinyalakan', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: Space.md), Text(message, style: const TextStyle(color: muted)),
          const SizedBox(height: Space.xl),
          FilledButton.icon(onPressed: _start, icon: const Icon(Icons.refresh), label: const Text('Coba lagi')),
        ]),
      ))),
    )),
  };
}
