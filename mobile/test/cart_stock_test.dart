import 'package:flutter_test/flutter_test.dart';
import '../lib/models/live_models.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mobile_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
import 'live_store_test.dart' show MemoryPending;

void main() {
  LiveStore store() => LiveStore(BusinessApi((path, {required method, query, body}) async =>
    {'lines': [], 'subtotal': 0, 'diskon': 0, 'total': 0}), MutationGuard(MemoryPending()));
  // 10 PCS in stock; a DUS is 6 PCS
  final pcs = LiveUnit(null, 'PCS', 1000), dus = LiveUnit(5, 'DUS', 5500, conversionFactor: 6);
  final p = LiveProduct(1, 'Mie Goreng', 'MIE', 10, [pcs, dus]);

  test('a line over the stock never lands in the cart', () {
    final s = store();
    expect(() => s.put(LiveCartItem(product: p, unit: pcs, quantity: 11)),
      throwsA(isA<ApiFailure>().having((e) => e.message, 'message', contains('Stok Mie Goreng tidak cukup'))));
    expect(s.items, isEmpty);
    s.put(LiveCartItem(product: p, unit: pcs, quantity: 10));
    expect(s.items.single.quantity, 10);
  });

  test('stock counts every satuan of the product in the base unit', () {
    final s = store();
    s.put(LiveCartItem(product: p, unit: dus, quantity: 1)); // 6 PCS
    s.put(LiveCartItem(product: p, unit: pcs, quantity: 4)); // 10 PCS, exactly the stock
    expect(() => s.put(LiveCartItem(product: p, unit: pcs, quantity: 5)), throwsA(isA<ApiFailure>()));
    expect(s.items.firstWhere((i) => i.unit == pcs).quantity, 4);
    // editing a line up past the stock is refused too, and the old line stays
    final dusLine = s.items.firstWhere((i) => i.unit == dus);
    expect(() => s.replace(dusLine, LiveCartItem(product: p, unit: dus, quantity: 2)), throwsA(isA<ApiFailure>()));
    expect(s.items.firstWhere((i) => i.unit == dus).quantity, 1);
  });

  test('editing a saved sale is not limited: its own quantity is already off the stock', () {
    final s = store()..editingSaleId = 7;
    s.put(LiveCartItem(product: p, unit: pcs, quantity: 12));
    expect(s.items.single.quantity, 12);
  });
}
