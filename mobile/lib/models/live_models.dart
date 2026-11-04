import '../services/mobile_api.dart';
import '../core/format.dart';
Map<String, dynamic> jsonObject(Object? value) {
  if (value is Map<String, dynamic>) return value;
  throw const ApiFailure('Format objek dari PC tidak dikenali.');
}
List<Map<String, dynamic>> jsonRows(Object? value) {
  if (value is Map) value = value['data'] ?? value['items'] ?? value['products'] ?? value['categories'] ?? value['suppliers'];
  if (value is! List) throw const ApiFailure('Format daftar dari PC tidak dikenali.');
  return value.map(jsonObject).toList();
}
num? number(Object? value) {
  final n = value is num ? value : num.tryParse(value?.toString() ?? '');
  return n != null && n.isFinite ? n : null;
}
int idNumber(Object? value) {
  final n = number(value);
  if (n == null || n <= 0 || n != n.round()) throw const ApiFailure('ID dari PC tidak valid.');
  return n.toInt();
}
String rupiah(Object? value) {
  final n = number(value);
  return n == null ? '—' : money((n * 100).round());
}
num inputRupiah(String text) => moneyInput(text) / 100;
num inputQty(String text, {bool zero = false}) => qtyInput(text, allowZero: zero) / 1000;
String quantityText(Object? value) {
  final n = number(value); return n == null ? '—' : qty((n * 1000).round());
}
String isoDate(DateTime date) => '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
class LiveUnit {
  LiveUnit(this.id, this.name, this.price);
  final int? id;
  final String name;
  final num? price;
}
class LiveProduct {
  LiveProduct(this.id, this.name, this.code, this.stock, this.units);
  final int id;
  final String name, code;
  final num? stock;
  final List<LiveUnit> units;
  factory LiveProduct.fromJson(Map<String, dynamic> data) {
    // The summary names CatalogItem without its field schema. Keep adaptation here.
    final id = idNumber(data['productId'] ?? data['id']);
    final base = data['satuan'];
    final baseName = base is String ? base : (base is Map ? base['nama']?.toString() : null);
    final units = <LiveUnit>[LiveUnit(null, baseName ?? data['baseUnitName']?.toString() ?? 'Satuan dasar', number(data['hargaJual'] ?? data['price']))];
    final nested = data['units'] ?? data['productUnits'] ?? data['satuanTurunan'];
    if (nested is List) {
      for (final raw in nested) {
        final u = jsonObject(raw);
        final uid = u['productUnitId'] ?? u['id'];
        if (uid == null) continue;
        final nestedUnit = u['unit'];
        final label = u['namaSatuan'] ?? u['satuan'] ?? u['name'] ?? u['nama'] ??
          (nestedUnit is Map ? nestedUnit['nama'] ?? nestedUnit['name'] : null);
        units.add(LiveUnit(idNumber(uid), label?.toString() ?? 'Satuan #$uid', number(u['hargaJual'] ?? u['price'])));
      }
    }
    return LiveProduct(id, (data['namaItem'] ?? data['name'] ?? data['nama'] ?? 'Produk #$id').toString(),
      (data['kodeItem'] ?? data['code'] ?? data['barcode'] ?? '').toString(), number(data['stok'] ?? data['stock']), units);
  }
}
class LiveCartItem {
  LiveCartItem({required this.product, required this.unit, required this.quantity, this.manualPrice, this.discount});
  final LiveProduct product;
  final LiveUnit unit;
  final num quantity;
  final num? manualPrice, discount;
  String get key => '${product.id}:${unit.id}';
  Map<String, dynamic> toJson() => {
    'productId': product.id, 'productUnitId': unit.id, 'qty': quantity,
    if (manualPrice != null) 'hargaJual': manualPrice, if (discount != null) 'diskon': discount,
  };
}
class ServerPrice {
  ServerPrice(this.lines, this.subtotal, this.discount, this.total);
  final List<Map<String, dynamic>> lines;
  final num subtotal, discount, total;
  factory ServerPrice.fromJson(Map<String, dynamic> data) {
    final lines = jsonRows(data['lines']);
    final subtotal = number(data['subtotal']), discount = number(data['diskon']), total = number(data['total']);
    if (subtotal == null || discount == null || total == null || total < 0 || lines.any((l) => l['stokCukup'] is! bool)) {
      throw const ApiFailure('Respons perhitungan keranjang PC tidak lengkap.');
    }
    return ServerPrice(lines, subtotal, discount, total);
  }
  bool get stockEnough => lines.every((line) => line['stokCukup'] == true);
}
