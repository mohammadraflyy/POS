import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/Widgets/admin.dart';
import '../lib/services/store_api.dart';

void main() {
  group('Date Quick Chips & Presets', () {
    test('presets generate correct ranges', () {
      final t = today();
      expect(t.start.day, t.end.day);
      expect(t.start.month, t.end.month);

      final y = yesterday();
      expect(y.start.isBefore(t.start), isTrue);

      final w = last7Days();
      expect(w.end.difference(w.start).inDays, 6);

      final m = thisMonth();
      expect(m.start.day, 1);

      final lm = lastMonth();
      expect(lm.start.isBefore(m.start), isTrue);
    });

    testWidgets('DateQuickChips switches ranges when chips are tapped', (tester) async {
      DateTimeRange? current = thisMonth();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) => DateQuickChips(
              selected: current,
              allowAll: true,
              onChanged: (val) => setState(() => current = val),
            ),
          ),
        ),
      ));

      expect(find.text('Hari ini'), findsOneWidget);
      expect(find.text('Bulan ini'), findsOneWidget);

      await tester.tap(find.text('Hari ini'));
      await tester.pumpAndSettle();
      expect(DateQuickChips.isSame(current!, today()), isTrue);

      await tester.tap(find.text('Semua'));
      await tester.pumpAndSettle();
      expect(current, isNull);
    });
  });

  group('Stock filter API support', () {
    test('store_api passes stockFilter query parameter', () async {
      String? recordedFilter;
      final api = StoreApi(
        (path, {required method, query, body}) async {
          recordedFilter = query?['stockFilter']?.toString();
          return {'data': <Object>[], 'currentPage': 1, 'lastPage': 1, 'total': 0};
        },
        (path, {method = 'GET', query, upload}) async => throw UnimplementedError(),
      );

      await api.products('kopi', 1, stockFilter: 'low');
      expect(recordedFilter, 'low');

      await api.products('teh', 1, stockFilter: 'out');
      expect(recordedFilter, 'out');
    });
  });
}

