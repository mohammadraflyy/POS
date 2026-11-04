import 'package:flutter_test/flutter_test.dart';
import '../lib/models/live_models.dart';
import '../lib/services/business_api.dart';
import '../lib/services/draft_store.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
import 'live_store_test.dart' show MemoryPending;

/// The sale in progress survives the app closing, as it did on the desktop.
void main() {
  BusinessApi api() => BusinessApi((path, {required method, query, body}) async {
    if (path == '/v1/carts/price') return {'lines': [for (final _ in body!['items'] as List) {'stokCukup': true, 'hargaJual': 3500, 'subtotal': 7000}], 'subtotal': 7000, 'diskon': 0, 'total': 7000};
    throw StateError('Unexpected request: $path');
  });
  final mie = LiveProduct(7, 'Mie Instan', 'MIE1', 40, [LiveUnit(null, 'PCS', 3500), LiveUnit(9, 'DUS', 115000)], barcode: '8991');

  test('a cart, its discount and its note come back after a restart', () async {
    final drafts = MemoryDraftStore();
    final guard = MutationGuard(MemoryPending()); await guard.load();
    final first = LiveStore(api(), guard, drafts: drafts);
    first.put(LiveCartItem(product: mie, unit: mie.units[1], quantity: 2, discount: 1000));
    first.setDiscount(500);
    first.setDetails(charge: 2000, text: 'Antar sore');
    await Future<void>.delayed(const Duration(milliseconds: 400));
    first.dispose();

    final second = LiveStore(api(), guard, drafts: drafts);
    expect(await second.restoreDraft(), 1);
    final line = second.items.single;
    expect((line.product.name, line.unit.id, line.quantity, line.discount), ('Mie Instan', 9, 2, 1000));
    expect((second.discount, second.otherCharge, second.note), (500, 2000, 'Antar sore'));
    second.dispose(); guard.dispose();
  });

  test('emptying the cart removes the draft; a broken draft is dropped', () async {
    final drafts = MemoryDraftStore();
    final guard = MutationGuard(MemoryPending()); await guard.load();
    final store = LiveStore(api(), guard, drafts: drafts);
    store.put(LiveCartItem(product: mie, unit: mie.units.first, quantity: 1));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(drafts.value, isNotNull);
    store.clear();
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(drafts.value, isNull);

    drafts.value = '{not json';
    expect(await store.restoreDraft(), 0);
    expect(drafts.value, isNull);
    store.dispose(); guard.dispose();
  });
}
