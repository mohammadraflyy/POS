import 'package:flutter_test/flutter_test.dart';
import '../lib/core/format.dart';
import '../lib/models/pos_models.dart';
import '../lib/services/demo_store.dart';
void main() {
  test('money cents and fractional quantity use explicit conversions', () {
    expect(moneyInput('12000,25'), 1200025);
    expect(qtyInput('0,2504'), 250);
    expect(qtyInput('0', allowZero: true), 0);
    expect(() => qtyInput('NaN'), throwsFormatException);
    expect(() => qtyInput('0.0001'), throwsFormatException);
    expect(() => moneyInput('12.000,25'), throwsFormatException);
    expect(money(1200025), 'Rp12.000,25');
    expect(qty(125500), '125,5');
  });
  test('aggregate PCS and DUS stock check fails without any mutation', () {
    final store = DemoStore(); final p = store.products.first;
    final before = p.stock;
    final lines = [CartLine(product: p, unit: p.units[1], quantity: 4000), CartLine(product: p, unit: p.units[0], quantity: 1000)];
    expect(() => store.checkout(lines: lines, discount: 0, method: PaymentMethod.tunai, tendered: 999999999, customer: ''), throwsFormatException);
    expect(p.stock, before); expect(store.receipts, isEmpty);
  });
  test('manual overrides tier then normal; override cannot be below cost', () {
    final p = DemoStore().products.first;
    expect(CartLine(product: p, unit: p.baseUnit, quantity: 6000).price, 1100000);
    expect(CartLine(product: p, unit: p.baseUnit, quantity: 1000).price, 1200000);
    expect(CartLine(product: p, unit: p.baseUnit, quantity: 6000, manualPrice: 1000000).price, 1000000);
    expect(() => CartLine(product: p, unit: p.baseUnit, quantity: 1000, manualPrice: 1).price, throwsFormatException);
  });
  test('discounts exceeding gross or net subtotal reject', () {
    final store = DemoStore(); final p = store.products.first;
    expect(() => store.validateCart([CartLine(product: p, unit: p.baseUnit, quantity: 1000, discount: 1200001)], 0), throwsFormatException);
    expect(() => store.validateCart([CartLine(product: p, unit: p.baseUnit, quantity: 1000, discount: 200000)], 1000001), throwsFormatException);
  });
  test('cash shortage rejects, checkout snapshots and reduces stock once', () {
    final store = DemoStore(); final p = store.products.first;
    final lines = [CartLine(product: p, unit: p.baseUnit, quantity: 1000)];
    expect(() => store.checkout(lines: lines, discount: 0, method: PaymentMethod.tunai, tendered: 1, customer: ''), throwsFormatException);
    expect(p.stock, 48000);
    final sale = store.checkout(lines: lines, discount: 0, method: PaymentMethod.tunai, tendered: 2000000, customer: '');
    expect(sale.change, 800000); expect(sale.remaining, 0); expect(p.stock, 47000);
    p.baseUnit.cost = 1;
    expect(sale.lines.first.cost, 600000);
    expect(store.movements.where((m) => m.productId == p.id).fold<int>(0, (v, m) => v + m.delta), p.stock);
  });
  test('qris and transfer auto-set paid amount; bon requires customer and caps payments', () {
    final store = DemoStore(); final p = store.products.first;
    final lines = [CartLine(product: p, unit: p.baseUnit, quantity: 1000)];
    for (final method in [PaymentMethod.qris, PaymentMethod.transfer]) {
      final sale = store.checkout(lines: lines, discount: 0, method: method, tendered: 0, customer: '');
      expect(sale.paid, sale.total); expect(sale.change, 0);
    }
    expect(() => store.checkout(lines: lines, discount: 0, method: PaymentMethod.bon, tendered: 0, customer: ' '), throwsFormatException);
    final bon = store.checkout(lines: lines, discount: 0, method: PaymentMethod.bon, tendered: 200000, customer: 'Rafly');
    expect(bon.remaining, 1000000);
    expect(() => store.payBon(bon, 1000001, ''), throwsFormatException);
    store.payBon(bon, 500000, 'Cicilan'); expect(bon.remaining, 500000);
  });
  test('opname overwrites quantity without changing cost and keeps ledger balanced', () {
    final store = DemoStore(); final p = store.products.first; final cost = p.cost;
    expect(store.adjust(p, 2000, 'Hitung fisik'), -46000);
    expect(p.stock, 2000); expect(p.cost, cost);
    expect(() => store.adjust(p, -1, ''), throwsFormatException);
    expect(store.movements.where((m) => m.productId == p.id).fold<int>(0, (v, m) => v + m.delta), p.stock);
  });
  test('purchase updates selected packaging descendants but not parent', () {
    final store = DemoStore(); final p = store.products.first; final parentCost = p.units[1].cost;
    store.purchase(product: p, unit: p.baseUnit, quantity: 2000, price: 800000, supplier: 'Supplier A', date: DateTime(2026, 9, 10), paid: 0);
    expect(p.stock, 50000); expect(p.cost, 608000); expect(p.units[1].cost, parentCost);
    expect(p.baseUnit.price, 1200000);
  });
  test('supplier payments allocate oldest invoice first and reject overpayment', () {
    final store = DemoStore(); final p = store.products.first;
    store.purchase(product: p, unit: p.baseUnit, quantity: 1000, price: 500000, supplier: 'A', date: DateTime(2026, 9, 10), paid: 0);
    store.purchase(product: p, unit: p.baseUnit, quantity: 1000, price: 500000, supplier: 'A', date: DateTime(2026, 9, 12), paid: 0);
    expect(() => store.paySupplier('A', 1000001), throwsFormatException);
    store.paySupplier('A', 600000);
    expect(store.purchases.last.remaining, 0); expect(store.purchases.first.remaining, 400000);
  });
}
