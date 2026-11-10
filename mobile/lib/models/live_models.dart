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
  // whole rupiah: a shop counts no sen, and a pro-rata discount must not print ',28'
  return n == null ? '—' : money(n.round() * 100);
}
num inputRupiah(String text) => moneyInput(text) / 100;
num inputDiscount(String text, {required num baseAmount}) {
  final raw = text.trim();
  if (raw.isEmpty) return 0;
  final pctMatch = RegExp(r'^(\d+(?:[.,]\d+)?)\s*%$').firstMatch(raw);
  if (pctMatch != null) {
    final pct = double.tryParse(pctMatch.group(1)!.replaceAll(',', '.'));
    if (pct == null || pct < 0 || pct > 100) {
      throw const FormatException('Diskon persen harus antara 0% sampai 100%.');
    }
    return (baseAmount * pct / 100).round();
  }
  return inputRupiah(raw);
}
num inputQty(String text, {bool zero = false}) => qtyInput(text, allowZero: zero) / 1000;
String quantityText(Object? value) {
  final n = number(value); return n == null ? '—' : qty((n * 1000).round());
}
String isoDate(DateTime date) => '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
class LiveUnit {
  LiveUnit(this.id, this.name, this.price, {this.cost, this.conversionFactor = 1});
  final int? id;
  final String name;
  final num? price;
  final num? cost;
  final int conversionFactor;
}
class LiveProduct {
  LiveProduct(this.id, this.name, this.code, this.stock, this.units, {this.barcode});
  final int id;
  final String name, code;
  final String? barcode;
  final num? stock;
  final List<LiveUnit> units;
  factory LiveProduct.fromJson(Map<String, dynamic> data) {
    // The summary names CatalogItem without its field schema. Keep adaptation here.
    final id = idNumber(data['productId'] ?? data['id']);
    final base = data['satuan'];
    final baseName = base is String ? base : (base is Map ? base['nama']?.toString() : null);
    final units = <LiveUnit>[
      LiveUnit(
        null,
        baseName ?? data['baseUnitName']?.toString() ?? 'Satuan dasar',
        number(data['hargaJual'] ?? data['price']),
        cost: number(data['hargaPokok'] ?? data['cost']),
      ),
    ];
    final nested = data['units'] ?? data['productUnits'] ?? data['satuanTurunan'];
    if (nested is List) {
      for (final raw in nested) {
        final u = jsonObject(raw);
        final uid = u['productUnitId'] ?? u['id'];
        if (uid == null) continue;
        final nestedUnit = u['unit'];
        final label = u['namaSatuan'] ?? u['satuan'] ?? u['name'] ?? u['nama'] ??
          (nestedUnit is Map ? nestedUnit['nama'] ?? nestedUnit['name'] : null);
        final conv = (number(u['konversi'] ?? u['conversionFactor']) ?? 1).round();
        units.add(LiveUnit(
          idNumber(uid),
          label?.toString() ?? 'Satuan #$uid',
          number(u['hargaJual'] ?? u['price']),
          cost: number(u['hargaPokok'] ?? u['cost']),
          conversionFactor: conv < 1 ? 1 : conv,
        ));
      }
    }
    return LiveProduct(id, (data['namaItem'] ?? data['name'] ?? data['nama'] ?? 'Produk #$id').toString(),
      (data['kodeItem'] ?? data['code'] ?? data['barcode'] ?? '').toString(), number(data['stok'] ?? data['stock']), units,
      barcode: data['barcode']?.toString());
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
  ServerPrice(this.lines, this.subtotal, this.discount, this.total, {this.modal});
  final List<Map<String, dynamic>> lines;
  final num subtotal, discount, total;
  final num? modal;
  factory ServerPrice.fromJson(Map<String, dynamic> data) {
    final lines = jsonRows(data['lines']);
    final subtotal = number(data['subtotal']), discount = number(data['diskon']), total = number(data['total']);
    if (subtotal == null || discount == null || total == null || total < 0 || lines.any((l) => l['stokCukup'] is! bool)) {
      throw const ApiFailure('Respons perhitungan keranjang PC tidak lengkap.');
    }
    return ServerPrice(lines, subtotal, discount, total, modal: number(data['modal']));
  }
  bool get stockEnough => lines.every((line) => line['stokCukup'] == true);
  num get lineDiscountTotal => lines.fold<num>(0, (sum, l) => sum + (number(l['diskon']) ?? 0));
  num? get estimatedModal {
    if (modal != null) return modal;
    num sum = 0;
    var any = false;
    for (final l in lines) {
      final c = number(l['hargaPokok']);
      final q = number(l['qty']);
      if (c != null && q != null) {
        sum += (c * q).round();
        any = true;
      }
    }
    return any ? sum : null;
  }
}
