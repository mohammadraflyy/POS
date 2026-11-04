import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import '../lib/models/live_models.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mobile_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
class MemoryPending implements PendingStore {
  String? value;
  @override Future<String?> read() async => value;
  @override Future<void> write(String data) async { value = data; }
  @override Future<void> clear() async { value = null; }
}
void main() {
  test('unknown commit is persisted and cannot be retried automatically', () async {
    final storage = MemoryPending(); final guard = MutationGuard(storage); await guard.load();
    var calls = 0;
    Future<void> commit() async { calls++; throw const ApiFailure('Koneksi terputus'); }
    await expectLater(guard.run('Penjualan', commit), throwsA(isA<ApiFailure>()));
    expect(storage.value, isNotNull);
    await expectLater(guard.run('Penjualan', commit), throwsA(isA<ApiFailure>())); expect(calls, 1);
    final restored = MutationGuard(storage); await restored.load(); expect(restored.pending, isNotNull);
    await restored.acknowledgeChecked(); expect(storage.value, isNull);
    guard.dispose(); restored.dispose();
  });
  test('definitive business refusal releases marker and preserves message', () async {
    final storage = MemoryPending(); final guard = MutationGuard(storage); await guard.load();
    await expectLater(guard.run('Pembelian', () async { throw const ApiFailure('Uang muka melebihi total', statusCode: 400); }), throwsA(isA<ApiFailure>().having((e) => e.message, 'message', 'Uang muka melebihi total')));
    expect(storage.value, isNull); guard.dispose();
  });
  test('print failure after successful sale clears cart and never repeats commit', () async {
    final guard = MutationGuard(MemoryPending()); await guard.load(); var commits = 0;
    final api = BusinessApi((path, {required method, query, body}) async {
      if (path == '/v1/carts/price') return {'lines': [{'stokCukup': true}], 'subtotal': 12345, 'diskon': 0, 'total': 12345};
      if (path == '/v1/sales') { commits++; expect(body!['dibayar'], 12345); return {'saleId': 41, 'total': 12345, 'printed': false, 'printError': 'Printer offline'}; }
      throw StateError('Unexpected request');
    });
    final store = LiveStore(api, guard);
    final product = LiveProduct.fromJson({'id': 1, 'namaItem': 'Produk', 'hargaJual': 999});
    store.put(LiveCartItem(product: product, unit: product.units.first, quantity: 1));
    await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(store.price!.total, 12345); // server value, not product price
    final result = await store.checkout('tunai', 12345, '');
    expect(result['printed'], false); expect(store.items, isEmpty); expect(commits, 1);
    await expectLater(store.checkout('tunai', 12345, ''), throwsA(isA<ApiFailure>())); expect(commits, 1);
    store.dispose(); guard.dispose();
  });
  test('obsolete price responses cannot replace newest cart total', () async {
    final first = Completer<Object?>(); var requests = 0;
    final api = BusinessApi((path, {required method, query, body}) async {
      requests++; if (requests == 1) return first.future;
      return {'lines': [{'stokCukup': true}], 'subtotal': 200, 'diskon': 0, 'total': 200};
    });
    final guard = MutationGuard(MemoryPending()); await guard.load(); final store = LiveStore(api, guard);
    final p = LiveProduct.fromJson({'id': 1});
    store.put(LiveCartItem(product: p, unit: p.units.first, quantity: 1));
    await Future<void>.delayed(const Duration(milliseconds: 260));
    store.put(LiveCartItem(product: p, unit: p.units.first, quantity: 2));
    await Future<void>.delayed(const Duration(milliseconds: 260));
    first.complete({'lines': [{'stokCukup': false}], 'subtotal': 100, 'diskon': 0, 'total': 100});
    await Future<void>.delayed(Duration.zero);
    expect(store.price!.total, 200); expect(store.canCheckout, true);
    store.dispose(); guard.dispose();
  });
}
