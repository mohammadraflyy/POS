import 'package:flutter_test/flutter_test.dart';
import '../lib/models/live_models.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mobile_api.dart';
import 'mobile_api_test.dart' show FakeTransport;
void main() {
  test('business requests keep bearer and decode arrays without appVersion', () async {
    final wire = FakeTransport([const ApiResponse(200, [{'id': 1, 'nama': 'Minuman'}])]);
    final api = MobileApi(transport: wire);
    final response = await api.requestRaw(base: parseAddress('192.168.1.5'), path: '/v1/opname/categories', token: 'test-device');
    expect(jsonRows(response).single['id'], 1);
    expect(wire.calls.single.$3['Authorization'], 'Bearer test-device');
  });
  test('stock shortage is valid preview; all items and rupiah go to PC', () async {
    final wire = FakeTransport([const ApiResponse(200, {'lines': [{'stokCukup': false}], 'subtotal': 12000, 'diskon': 500, 'total': 11500})]);
    final api = MobileApi(transport: wire);
    final business = BusinessApi((path, {required method, query, body}) => api.requestRaw(base: parseAddress('192.168.1.5'), path: path, method: method, query: query, body: body, token: 't'));
    final product = LiveProduct.fromJson({'id': 1, 'namaItem': 'Kopi', 'satuan': 'PCS'});
    final result = await business.price([LiveCartItem(product: product, unit: product.units.first, quantity: 1, manualPrice: 12000)], 500);
    expect(result.stockEnough, false); expect(result.total, 11500);
    expect(wire.calls.single.$2.path, '/v1/carts/price');
    final body = wire.calls.single.$4!;
    expect(body['diskonNota'], 500);
    expect((body['items'] as List).single, {'productId': 1, 'productUnitId': null, 'qty': 1, 'hargaJual': 12000});
  });
  test('queries are encoded and supplier/opname routes use documented fields', () async {
    final calls = <(String, String, Map<String, String>?, Map<String, dynamic>?)>[];
    final business = BusinessApi((path, {required method, query, body}) async {
      calls.add((path, method, query, body));
      return {'data': <Object>[]};
    });
    await business.suppliers('A & B', 2);
    await business.createSupplier({'nama': 'Toko', 'telepon': null, 'alamat': null, 'keterangan': null});
    await business.adjust(9, 0.25, null);
    expect(calls[0].$3, {'q': 'A & B', 'page': '2'});
    expect(calls[1].$1, '/v1/suppliers');
    expect(calls[2].$4, {'productId': 9, 'stokSesudah': 0.25, 'alasan': null});
  });
  test('400 preserves PC message and explicit status', () async {
    final api = MobileApi(transport: FakeTransport([const ApiResponse(400, {'error': 'Diskon melebihi subtotal'})]));
    await expectLater(api.requestRaw(base: parseAddress('192.168.1.5'), path: '/v1/carts/price', method: 'POST', token: 't'),
      throwsA(isA<ApiFailure>().having((e) => e.message, 'message', 'Diskon melebihi subtotal').having((e) => e.statusCode, 'status', 400)));
  });
  test('missing stock status cannot silently authorize checkout', () {
    expect(() => ServerPrice.fromJson({'lines': [{}], 'subtotal': 0, 'diskon': 0, 'total': 0}), throwsA(isA<ApiFailure>()));
  });
}
