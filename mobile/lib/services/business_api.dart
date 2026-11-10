import '../models/live_models.dart';
typedef AuthRequest = Future<Object?> Function(String path, {required String method,
  Map<String, String>? query, Map<String, dynamic>? body});
class BusinessApi {
  BusinessApi(this.request);
  final AuthRequest request;
  Future<Object?> get(String path, [Map<String, String>? query]) => request(path, method: 'GET', query: query);
  Future<Object?> post(String path, [Map<String, dynamic>? body]) => request(path, method: 'POST', body: body);
  Future<Map<String, dynamic>> catalog(String q, int page) async => jsonObject(await get('/v1/catalog/search', {'q': q, 'page': '$page', 'pageSize': '24'}));
  Future<Map<String, dynamic>> products(String search, int page, {int pageSize = 25, String? stockFilter}) async =>
      jsonObject(await get('/v1/products', {'search': search, 'page': '$page', 'pageSize': '$pageSize', if (stockFilter != null) 'stockFilter': stockFilter}));
  Future<List<String>> customers() async {
    final result = jsonObject(await get('/v1/customers'));
    return (result['names'] as List).map((name) => name.toString()).toList();
  }
  Future<ServerPrice> price(List<LiveCartItem> items, num discount) async => ServerPrice.fromJson(jsonObject(await post('/v1/carts/price', {
    'items': items.map((i) => i.toJson()).toList(), 'diskonNota': discount,
  })));
  Future<Map<String, dynamic>> checkout(Map<String, dynamic> input) async => jsonObject(await post('/v1/sales', input));
  Future<Map<String, dynamic>> sales(Map<String, String> filters) async => jsonObject(await get('/v1/sales', filters));
  Future<Map<String, dynamic>> sale(int id) async => jsonObject(await get('/v1/sales/$id'));
  Future<Map<String, dynamic>> printSale(int id) async => jsonObject(await post('/v1/sales/$id/print'));
  Future<Object?> suppliers(String q, int page) => get('/v1/suppliers', {'q': q, 'page': '$page'});
  Future<Object?> createSupplier(Map<String, dynamic> body) => post('/v1/suppliers', body);
  Future<List<LiveProduct>> purchaseProducts(String q) async => jsonRows(await get('/v1/purchases/products', {'q': q})).map(LiveProduct.fromJson).toList();
  Future<LiveProduct> purchaseBarcode(String code) async {
    final result = jsonObject(await get('/v1/purchases/products/barcode/${Uri.encodeComponent(code)}'));
    return LiveProduct.fromJson(result['data'] is Map ? jsonObject(result['data']) : result['product'] is Map ? jsonObject(result['product']) : result);
  }
  Future<Object?> purchase(Map<String, dynamic> input) => post('/v1/purchases', input);
  Future<List<Map<String, dynamic>>> categories() async => jsonRows(await get('/v1/opname/categories'));
  Future<List<Map<String, dynamic>>> opname(String q, Set<int> categories) async => jsonRows(await get('/v1/opname/products', {'q': q, 'categoryIds': categories.join(',')}));
  Future<Object?> adjust(int id, num after, String? reason, {num? expectedStock, int? expectedRevision}) =>
      post('/v1/opname/adjustments', {
        'productId': id,
        'stokSesudah': after,
        'alasan': reason,
        if (expectedStock != null) 'expectedStock': expectedStock,
        if (expectedRevision != null) 'expectedRevision': expectedRevision,
      });
}
