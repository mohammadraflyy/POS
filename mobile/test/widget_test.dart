import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/state/app_state.dart';
import '../lib/Screen/MainScreen.dart';
void main() {
  for (final size in [const Size(1280, 800), const Size(390, 844), const Size(844, 390)]) {
    testWidgets('cashier layout and add-to-cart at $size', (tester) async {
      tester.view.physicalSize = size; tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final app = AppState()..startDemo();
      await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: MainScreen(app: app)));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final add = find.byTooltip('Tambah Kopi Susu Aren');
      // In landscape the lazy product grid starts below the viewport.
      for (var attempt = 0; attempt < 12 && add.hitTestable().evaluate().isEmpty; attempt++) {
        await tester.drag(find.byType(CustomScrollView).first, const Offset(0, -100));
        await tester.pumpAndSettle();
      }
      expect(add.hitTestable(), findsOneWidget);
      await tester.tap(add); await tester.pumpAndSettle();
      expect(app.cart.length, 1); expect(app.total, 1200000);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox()); app.dispose();
    });
  }
}
