import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/Screen/Live/LiveHistoryScreen.dart';
import '../lib/services/business_api.dart';
import 'admin_tools_test.dart' show show;

void main() {
  test('profitColor: green above zero, red below, neutral for zero and unknown', () {
    expect(profitColor(1), pillPositiveInk);
    expect(profitColor(-1), pillNegativeInk);
    expect(profitColor(0), isNull);
    expect(profitColor(null), isNull);
  });

  testWidgets('Riwayat colours a loss red and a gain green in the Laba column', (tester) async {
    final api = BusinessApi((path, {required method, query, body}) async {
      if (path != '/v1/sales') throw StateError('Unexpected $path');
      Map<String, Object?> sale(int id, int total, int laba) => {
        'id': id, 'createdAt': '2026-11-10T09:00:00.000', 'namaPelanggan': 'Bu Siti', 'metodePembayaran': 'tunai',
        'status': 'selesai', 'total': total, 'dibayar': total, 'laba': laba, 'items': [{'namaItem': 'Beras', 'qty': 2}],
      };
      return {'data': [sale(1, 15000, 3333), sale(2, 9000, -2222)], 'currentPage': 1, 'lastPage': 1};
    });
    await show(tester, LiveHistoryScreen(api: api, isAdmin: true));

    Color? inkOf(String amount) => tester.widget<Text>(find.textContaining(amount).first).style?.color;
    expect(inkOf('3.333'), pillPositiveInk);
    expect(inkOf('2.222'), pillNegativeInk);
  });
}
