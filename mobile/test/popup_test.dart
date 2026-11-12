import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/Widgets/admin.dart';
import '../lib/Widgets/notifications.dart';

void main() {
  Future<BuildContext> host(WidgetTester tester) async {
    late BuildContext ctx;
    await tester.pumpWidget(MaterialApp(theme: buildTheme(Palette.light),
      home: Scaffold(body: Builder(builder: (c) { ctx = c; return const SizedBox(); }))));
    return ctx;
  }

  testWidgets('confirm popup: Enter confirms, Esc cancels, and desktop shows both keys', (tester) async {
    final ctx = await host(tester);

    bool? answer;
    confirmAction(ctx, title: 'Hapus Mie?', message: 'Produk akan dihapus.', destructive: true, confirmLabel: 'Hapus')
      .then((v) => answer = v);
    await tester.pumpAndSettle();
    expect(find.text('Enter'), findsOneWidget);
    expect(find.text('Esc'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(answer, isTrue);

    answer = null;
    confirmAction(ctx, title: 'Hapus Mie?', message: 'Produk akan dihapus.').then((v) => answer = v);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(answer, isFalse);
  }, variant: TargetPlatformVariant.only(TargetPlatform.windows));

  testWidgets('a phone shows no keyboard hints', (tester) async {
    final ctx = await host(tester);
    showNotice(ctx, 'Tersimpan.', kind: NoticeKind.success);
    await tester.pumpAndSettle();
    expect(find.text('Mengerti'), findsOneWidget);
    expect(find.text('Enter'), findsNothing);
  }, variant: TargetPlatformVariant.only(TargetPlatform.android));
}
