import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/Screen/LocalServerGate.dart';
import '../lib/services/local_server.dart';

void main() {
  testWidgets('holds the app back until the server is up', (tester) async {
    await tester.pumpWidget(LocalServerGate(
      start: () async => const LocalServerReady(dbPath: 'pos.sqlite'),
      child: const MaterialApp(home: Text('aplikasi toko')),
    ));
    await tester.pumpAndSettle();

    expect(find.text('aplikasi toko'), findsOneWidget);
  });

  testWidgets('explains a failed start and tries again on request', (tester) async {
    var attempts = 0;

    await tester.pumpWidget(LocalServerGate(
      start: () async => ++attempts == 1
          ? const LocalServerFailed('Port 48950 sedang dipakai aplikasi lain.')
          : const LocalServerReady(dbPath: 'pos.sqlite'),
      child: const MaterialApp(home: Text('aplikasi toko')),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Port 48950 sedang dipakai aplikasi lain.'), findsOneWidget);
    expect(find.text('aplikasi toko'), findsNothing);

    await tester.tap(find.text('Coba lagi'));
    await tester.pumpAndSettle();

    expect(attempts, 2);
    expect(find.text('aplikasi toko'), findsOneWidget);
  });
}
