import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/Widgets/popup.dart' show AppPopup;
import '../lib/Widgets/ui.dart';
import '../lib/Screen/Pairing/PairingScreen.dart';
import '../lib/Screen/Live/LiveSaleScreen.dart';
import '../lib/services/business_api.dart';
import '../lib/state/app_state.dart';

void main() {
  testWidgets('modal deduplicates, queues, and requires acknowledgement', (tester) async {
    late BuildContext page;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      page = context;
      return const Scaffold(body: Text('Form'));
    })));
    final first = showNotice(page, 'Gagal menyimpan', kind: NoticeKind.error);
    final duplicate = showNotice(page, 'Gagal menyimpan', kind: NoticeKind.error);
    expect(identical(first, duplicate), isTrue);
    final second = showNotice(page, 'Periksa PC', kind: NoticeKind.warning);
    await tester.pumpAndSettle();
    expect(find.byType(AppPopup), findsOneWidget);
    expect(find.text('Gagal menyimpan'), findsOneWidget);
    await tester.tapAt(const Offset(5, 5));
    await tester.pumpAndSettle();
    expect(find.text('Gagal menyimpan'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Gagal menyimpan'), findsOneWidget);
    await tester.tap(find.text('Mengerti'));
    await tester.pumpAndSettle();
    await first;
    expect(find.text('Periksa PC'), findsOneWidget);
    await tester.tap(find.text('Mengerti'));
    await tester.pumpAndSettle();
    await second;
    expect(find.byType(AppPopup), findsNothing);
  });

  testWidgets('persistent warning appears once, and again after recovery', (tester) async {
    final message = ValueNotifier<String?>('Koneksi terputus');
    await tester.pumpWidget(MaterialApp(home: ValueListenableBuilder<String?>(
      valueListenable: message, builder: (_, value, __) => NoticeListener(
        message: value, child: const Scaffold(body: Text('Kasir'))),
    )));
    await tester.pumpAndSettle();
    expect(find.text('Koneksi terputus'), findsOneWidget);
    await tester.tap(find.text('Mengerti'));
    await tester.pumpAndSettle();
    message.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.byType(AppPopup), findsNothing);
    message.value = null;
    await tester.pump();
    message.value = 'Koneksi terputus';
    await tester.pumpAndSettle();
    expect(find.byType(AppPopup), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    message.dispose();
  });

  testWidgets('pairing validation is visible in a modal on a small screen', (tester) async {
    tester.view.physicalSize = const Size(390, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final app = AppState();
    await tester.pumpWidget(MaterialApp(home: PairingScreen(app: app)));
    final button = find.widgetWithText(FilledButton, 'Hubungkan perangkat');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byType(AppPopup),
      matching: find.text('Isi kode 6 digit, username, dan password.')), findsOneWidget);
    await tester.tap(find.text('Mengerti'));
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.byType(AppPopup), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });

  testWidgets('saved sale with failed printing warns without resubmitting', (tester) async {
    final requests = <String>[];
    final api = BusinessApi((path, {required method, query, body}) async {
      requests.add('$method $path');
      return {'id': 7, 'total': 1000, 'items': <Object>[]};
    });
    await tester.pumpWidget(MaterialApp(home: LiveSaleScreen(api: api, id: 7,
      confirmation: const {'saleId': 7, 'total': 1000, 'printed': false})));
    await tester.pumpAndSettle();
    expect(find.byType(AppPopup), findsOneWidget);
    expect(find.descendant(of: find.byType(AppPopup),
      matching: find.textContaining('Jangan membuat penjualan lagi')), findsOneWidget);
    await tester.tap(find.text('Nanti'));
    await tester.pumpAndSettle();
    expect(requests, ['GET /v1/sales/7']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disposed notification source does not open a queued dialog', (tester) async {
    late BuildContext page;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      page = context;
      return const Scaffold();
    })));
    showNotice(page, 'Pesan lama');
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    await showNotice(page, 'Pesan dari layar yang sudah ditutup');
    expect(tester.takeException(), isNull);
  });

  testWidgets('Mengerti button can be dismissed with Enter and NumpadEnter key', (tester) async {
    late BuildContext page;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      page = context;
      return const Scaffold(body: Text('Form'));
    })));
    final first = showNotice(page, 'Peringatan 1', kind: NoticeKind.warning);
    await tester.pumpAndSettle();
    expect(find.text('Peringatan 1'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await first;
    expect(find.byType(AppPopup), findsNothing);

    final second = showNotice(page, 'Peringatan 2', kind: NoticeKind.error);
    await tester.pumpAndSettle();
    expect(find.text('Peringatan 2'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.numpadEnter);
    await tester.pumpAndSettle();
    await second;
    expect(find.byType(AppPopup), findsNothing);
  });
}
