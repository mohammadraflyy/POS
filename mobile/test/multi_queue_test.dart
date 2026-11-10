import 'package:flutter_test/flutter_test.dart';
import '../lib/models/live_models.dart';
import '../lib/services/business_api.dart';
import '../lib/services/draft_store.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
import 'live_store_test.dart' show MemoryPending;

void main() {
  BusinessApi api() => BusinessApi((path, {required method, query, body}) async {
    if (path == '/v1/carts/price') {
      return {
        'lines': [for (final _ in body!['items'] as List) {'stokCukup': true, 'hargaJual': 5000, 'subtotal': 5000}],
        'subtotal': 5000,
        'diskon': 0,
        'total': 5000,
      };
    }
    if (path == '/v1/sales' && method == 'POST') {
      return {'saleId': 99, 'total': 5000, 'dibayar': 5000, 'kembalian': 0, 'printed': true};
    }
    throw StateError('Unexpected request: $path');
  });

  final tea = LiveProduct(1, 'Teh Botol', 'TEH1', 50, [LiveUnit(null, 'BTL', 5000)]);
  final coffee = LiveProduct(2, 'Kopi Susu', 'KOP1', 30, [LiveUnit(null, 'CUP', 8000)]);

  test('multi-queue cart supports creating, switching, holding, and closing queues', () async {
    final drafts = MemoryDraftStore();
    final guard = MutationGuard(MemoryPending());
    await guard.load();
    final store = LiveStore(api(), guard, drafts: drafts);

    // Initial state: Queue 1
    expect(store.queues.length, 1);
    expect(store.activeQueueIndex, 0);

    // Add tea to Queue 1
    store.put(LiveCartItem(product: tea, unit: tea.units.first, quantity: 2));
    store.customerName = 'Budi';
    expect(store.items.length, 1);

    // Hold cart / new queue: creates Queue 2
    store.newQueue(name: 'Antrean Bu Ani');
    expect(store.queues.length, 2);
    expect(store.activeQueueIndex, 1);
    expect(store.items.isEmpty, isTrue); // Queue 2 starts empty

    // Add coffee to Queue 2
    store.put(LiveCartItem(product: coffee, unit: coffee.units.first, quantity: 1));
    store.customerName = 'Bu Ani';
    expect(store.items.length, 1);
    expect(store.items.first.product.name, 'Kopi Susu');

    // Switch back to Queue 1
    store.switchQueue(0);
    expect(store.activeQueueIndex, 0);
    expect(store.items.length, 1);
    expect(store.items.first.product.name, 'Teh Botol');
    expect(store.customerName, 'Budi');

    // Switch back to Queue 2
    store.switchQueue(1);
    expect(store.items.first.product.name, 'Kopi Susu');
    expect(store.customerName, 'Bu Ani');

    // Close Queue 2 -> should switch back to remaining Queue 1
    final removed = store.removeQueue(1);
    expect(removed, isTrue);
    expect(store.queues.length, 1);
    expect(store.activeQueueIndex, 0);
    expect(store.items.first.product.name, 'Teh Botol');
    expect(store.customerName, 'Budi');

    store.dispose();
    guard.dispose();
  });
}
