class PriceTier {
  const PriceTier(this.minQty, this.maxQty, this.price);
  final int minQty, price;
  final int? maxQty;
}
class ProductUnit {
  ProductUnit({required this.id, required this.name, required this.factor,
    required this.price, required this.cost, this.tiers = const [], this.insideIds = const []});
  final int id, factor, price;
  int cost;
  final String name;
  final List<PriceTier> tiers;
  final List<int> insideIds;
  int resolve(int quantity, int? manual) {
    if (manual != null) {
      if (manual < cost) throw const FormatException('Harga manual tidak boleh di bawah harga pokok.');
      return manual;
    }
    for (final tier in tiers) {
      if (quantity >= tier.minQty && (tier.maxQty == null || quantity <= tier.maxQty!)) return tier.price;
    }
    return price;
  }
}
class Product {
  Product({required this.id, required this.name, required this.code,
    required this.barcode, required this.category, required this.glyph,
    required this.color, required this.stock, required this.units, this.cost = 0});
  final int id, color;
  int stock, cost;
  final String name, code, barcode, category, glyph;
  final List<ProductUnit> units;
  ProductUnit get baseUnit => units.first;
}
class CartLine {
  CartLine({required this.product, required this.unit, required this.quantity,
    this.manualPrice, this.discount = 0});
  final Product product;
  final ProductUnit unit;
  final int quantity, discount;
  final int? manualPrice;
  String get key => '${product.id}:${unit.id}';
  int get price => unit.resolve(quantity, manualPrice);
  int get gross => (quantity * price / 1000).round();
  int get total => gross - discount;
  int get baseQuantity => quantity * unit.factor;
  CartLine copy({int? quantity}) => CartLine(product: product, unit: unit,
    quantity: quantity ?? this.quantity, manualPrice: manualPrice, discount: discount);
  void validate() {
    if (quantity <= 0) throw const FormatException('Jumlah harus lebih dari 0.');
    if (discount < 0 || discount > gross) throw const FormatException('Diskon barang melebihi nilai barang.');
  }
}
enum PaymentMethod { tunai, qris, transfer, bon }
class ReceiptLine {
  ReceiptLine(CartLine line): name = line.product.name, unit = line.unit.name,
    quantity = line.quantity, price = line.price, discount = line.discount,
    total = line.total, cost = line.unit.cost;
  final String name, unit;
  final int quantity, price, discount, total, cost;
}
class BonPayment {
  BonPayment(this.amount, this.note): date = DateTime.now();
  final int amount;
  final String note;
  final DateTime date;
}
class SaleReceipt {
  SaleReceipt({required this.id, required this.lines, required this.subtotal,
    required this.discount, required this.total, required this.tendered,
    required this.paid, required this.method, required this.customer}): date = DateTime.now();
  final String id, customer;
  final List<ReceiptLine> lines;
  final int subtotal, discount, total, tendered;
  int paid;
  final PaymentMethod method;
  final DateTime date;
  final List<BonPayment> payments = [];
  int get change => method == PaymentMethod.tunai ? tendered - total : 0;
  int get remaining => total - paid;
}
class PurchaseEntry {
  PurchaseEntry({required this.id, required this.supplier, required this.product,
    required this.unit, required this.quantity, required this.total,
    required this.paid, required this.date});
  final String id, supplier, product, unit;
  final int quantity, total;
  int paid;
  final DateTime date;
  int get remaining => total - paid;
}
class StockMovement {
  StockMovement(this.productId, this.type, this.delta, this.reason): date = DateTime.now();
  final int productId, delta;
  final String type, reason;
  final DateTime date;
}
