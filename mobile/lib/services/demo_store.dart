import '../models/pos_models.dart';
/// In-memory sandbox only. Never used for a connected PC session.
class DemoStore {
  final List<Product> products = [
    Product(id: 1, name: 'Kopi Susu Aren', code: 'MIN-001', barcode: '8991001000011', category: 'Minuman', glyph: '☕', color: 0xFFF1E0D2, stock: 48000, cost: 600000, units: [
      ProductUnit(id: 1, name: 'PCS', factor: 1, price: 1200000, cost: 600000, tiers: [const PriceTier(6000, null, 1100000)]),
      ProductUnit(id: 2, name: 'DUS', factor: 12, price: 13200000, cost: 7200000, insideIds: [1]),
    ]),
    Product(id: 2, name: 'Teh Melati', code: 'MIN-002', barcode: '8991001000028', category: 'Minuman', glyph: '🍵', color: 0xFFE5EBD9, stock: 65000, cost: 300000, units: [ProductUnit(id: 3, name: 'PCS', factor: 1, price: 600000, cost: 300000)]),
    Product(id: 3, name: 'Air Mineral 600 ml', code: 'MIN-003', barcode: '8991001000035', category: 'Minuman', glyph: '💧', color: 0xFFDBEDF2, stock: 96000, cost: 200000, units: [
      ProductUnit(id: 4, name: 'PCS', factor: 1, price: 400000, cost: 200000),
      ProductUnit(id: 5, name: 'DUS', factor: 24, price: 8500000, cost: 4800000, insideIds: [4]),
    ]),
    Product(id: 4, name: 'Roti Cokelat', code: 'MKN-001', barcode: '8991001000042', category: 'Makanan', glyph: '🥐', color: 0xFFF9E5BF, stock: 24000, cost: 450000, units: [ProductUnit(id: 6, name: 'PCS', factor: 1, price: 850000, cost: 450000)]),
    Product(id: 5, name: 'Keripik Kentang', code: 'MKN-002', barcode: '8991001000059', category: 'Makanan', glyph: '🥔', color: 0xFFF1DACA, stock: 18000, cost: 750000, units: [ProductUnit(id: 7, name: 'PCS', factor: 1, price: 1400000, cost: 750000)]),
    Product(id: 6, name: 'Biskuit Butter', code: 'MKN-003', barcode: '8991001000066', category: 'Makanan', glyph: '🍪', color: 0xFFF3E6D7, stock: 30000, cost: 600000, units: [ProductUnit(id: 8, name: 'PCS', factor: 1, price: 1000000, cost: 600000)]),
    Product(id: 7, name: 'Beras Premium', code: 'PKK-001', barcode: '8991001000073', category: 'Sembako', glyph: '🌾', color: 0xFFE9E8D3, stock: 125500, cost: 1200000, units: [ProductUnit(id: 9, name: 'KG', factor: 1, price: 1600000, cost: 1200000)]),
    Product(id: 8, name: 'Gula Pasir', code: 'PKK-002', barcode: '8991001000080', category: 'Sembako', glyph: '🧂', color: 0xFFE4EAF1, stock: 40750, cost: 1400000, units: [ProductUnit(id: 10, name: 'KG', factor: 1, price: 1800000, cost: 1400000)]),
    Product(id: 9, name: 'Minyak Goreng', code: 'PKK-003', barcode: '8991001000097', category: 'Sembako', glyph: '🌻', color: 0xFFF7EAC1, stock: 20000, cost: 1550000, units: [ProductUnit(id: 11, name: 'LITER', factor: 1, price: 2000000, cost: 1550000)]),
    Product(id: 10, name: 'Sabun Cuci', code: 'RTG-001', barcode: '8991001000103', category: 'Rumah tangga', glyph: '🫧', color: 0xFFD8E9E3, stock: 0, cost: 800000, units: [ProductUnit(id: 12, name: 'PCS', factor: 1, price: 1300000, cost: 800000)]),
  ];
  final List<SaleReceipt> receipts = [];
  final List<PurchaseEntry> purchases = [];
  final List<StockMovement> movements = [];
  DemoStore() {
    for (final product in products) {
      movements.add(StockMovement(product.id, 'opening', product.stock, 'Stok awal demo'));
    }
  }
  void validateCart(List<CartLine> lines, int discount) {
    if (lines.isEmpty) throw const FormatException('Pilih minimal satu barang.');
    final required = <int, int>{};
    var subtotal = 0;
    for (final line in lines) {
      line.validate();
      subtotal += line.total;
      required.update(line.product.id, (v) => v + line.baseQuantity, ifAbsent: () => line.baseQuantity);
    }
    if (discount < 0 || discount > subtotal) throw const FormatException('Diskon nota melebihi subtotal.');
    for (final product in products) {
      if ((required[product.id] ?? 0) > product.stock) {
        throw FormatException('Stok ${product.name} tidak mencukupi untuk seluruh satuan di keranjang.');
      }
    }
  }
  SaleReceipt checkout({required List<CartLine> lines, required int discount,
    required PaymentMethod method, required int tendered, required String customer}) {
    validateCart(lines, discount);
    final subtotal = lines.fold<int>(0, (sum, line) => sum + line.total);
    final total = subtotal - discount;
    if (tendered < 0) throw const FormatException('Pembayaran tidak boleh negatif.');
    if (method == PaymentMethod.tunai && tendered < total) throw const FormatException('Uang tunai masih kurang.');
    if (method == PaymentMethod.bon && customer.trim().isEmpty) throw const FormatException('Nama pelanggan wajib untuk bon.');
    if (method == PaymentMethod.bon && tendered > total) throw const FormatException('Pembayaran bon melebihi total.');
    final receipt = SaleReceipt(id: 'DEMO-${(receipts.length + 1).toString().padLeft(4, '0')}',
      lines: lines.map(ReceiptLine.new).toList(growable: false), subtotal: subtotal, discount: discount,
      total: total, tendered: method == PaymentMethod.qris || method == PaymentMethod.transfer ? total : tendered,
      paid: method == PaymentMethod.bon ? tendered : total, method: method, customer: customer.trim());
    // Validation completes before any mutation. No asynchronous operations here.
    for (final line in lines) {
      line.product.stock -= line.baseQuantity;
      movements.add(StockMovement(line.product.id, 'sale', -line.baseQuantity, receipt.id));
    }
    receipts.insert(0, receipt);
    return receipt;
  }
  void payBon(SaleReceipt sale, int amount, String note) {
    if (sale.method != PaymentMethod.bon || amount <= 0 || amount > sale.remaining) {
      throw const FormatException('Jumlah harus lebih dari 0 dan tidak melebihi sisa bon.');
    }
    if (note.length > 500) throw const FormatException('Keterangan maksimal 500 karakter.');
    sale.paid += amount;
    sale.payments.add(BonPayment(amount, note));
  }
  void purchase({required Product product, required ProductUnit unit, required int quantity,
    required int price, required String supplier, required DateTime date, int? paid}) {
    if (supplier.trim().isEmpty) throw const FormatException('Isi nama supplier.');
    if (quantity <= 0 || price < 0) throw const FormatException('Jumlah harus positif dan harga tidak negatif.');
    final total = (quantity * price / 1000).round();
    if (paid != null && (paid < 0 || paid > total || paid % 100 != 0)) {
      throw const FormatException('Uang muka harus rupiah bulat dan tidak melebihi total.');
    }
    final incoming = quantity * unit.factor;
    final after = product.stock + incoming;
    final old = product.stock;
    final newCost = ((old * product.cost + total * 1000) / after).round();
    final unitCosts = <ProductUnit, int>{};
    for (final candidate in product.units) {
      if (candidate.id == unit.id || unit.insideIds.contains(candidate.id)) {
        unitCosts[candidate] = ((old * candidate.cost + total * 1000 * candidate.factor) / after).round();
      }
    }
    product.cost = newCost;
    unitCosts.forEach((u, cost) => u.cost = cost);
    product.stock = after;
    final id = 'BELI-DEMO-${purchases.length + 1}';
    purchases.insert(0, PurchaseEntry(id: id, supplier: supplier.trim(), product: product.name,
      unit: unit.name, quantity: quantity, total: total, paid: paid ?? total, date: date));
    movements.add(StockMovement(product.id, 'purchase', incoming, id));
  }
  List<String> paySupplier(String supplier, int amount) {
    final invoices = purchases.where((p) => p.supplier == supplier && p.remaining > 0).toList()
      ..sort((a, b) { final byDate = a.date.compareTo(b.date); return byDate != 0 ? byDate : a.id.compareTo(b.id); });
    final debt = invoices.fold<int>(0, (s, p) => s + p.remaining);
    if (amount <= 0 || amount > debt) throw const FormatException('Pembayaran harus positif dan tidak melebihi utang supplier.');
    var remaining = amount;
    final allocated = <String>[];
    for (final invoice in invoices) {
      if (remaining == 0) break;
      final take = remaining < invoice.remaining ? remaining : invoice.remaining;
      invoice.paid += take;
      remaining -= take;
      allocated.add(invoice.id);
    }
    return allocated;
  }
  int adjust(Product product, int after, String reason) {
    if (after < 0) throw const FormatException('Stok fisik tidak boleh negatif.');
    if (reason.length > 255) throw const FormatException('Alasan maksimal 255 karakter.');
    final delta = after - product.stock;
    product.stock = after;
    movements.add(StockMovement(product.id, 'stock_adjustment', delta, reason));
    return delta;
  }
}
