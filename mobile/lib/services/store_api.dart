import '../models/live_models.dart';
import 'business_api.dart';
import 'mobile_api.dart';

typedef FileRequest = Future<FileResponse> Function(String path, {String method, Map<String, String>? query, List<int>? upload});

/// Everything beyond the till: catalog upkeep, purchases and supplier debt, cash, reports,
/// users and settings. Money goes over the wire in rupiah, exactly as typed.
class StoreApi extends BusinessApi {
  StoreApi(super.request, this.file);
  final FileRequest file;

  Future<Object?> put(String path, [Map<String, dynamic>? body]) => request(path, method: 'PUT', body: body);
  Future<Object?> delete(String path) => request(path, method: 'DELETE');
  Future<Map<String, dynamic>> getObject(String path, [Map<String, String>? query]) async => jsonObject(await get(path, query));
  Future<List<Map<String, dynamic>>> getRows(String path, [Map<String, String>? query]) async => jsonRows(await get(path, query));

  static Map<String, String> _q(Map<String, Object?> values) =>
      {for (final e in values.entries) if (e.value != null && e.value.toString().isNotEmpty) e.key: e.value.toString()};

  // --- dashboard & reports ---
  Future<Map<String, dynamic>> dashboard() => getObject('/v1/dashboard');
  Future<Map<String, dynamic>> rekap(String from, String to) => getObject('/v1/rekap', {'from': from, 'to': to});
  Future<FileResponse> rekapExport(String from, String to) => file('/v1/rekap/export', query: {'from': from, 'to': to});

  // --- koreksi HPP (body: saleItemId, scope item|period, from, to, hargaPokok in rupiah) ---
  Future<Map<String, dynamic>> previewCostCorrection(Map<String, dynamic> body) async => jsonObject(await post('/v1/rekap/cost-corrections/preview', body));
  Future<Map<String, dynamic>> applyCostCorrection(Map<String, dynamic> body) async => jsonObject(await post('/v1/rekap/cost-corrections', body));
  Future<List<Map<String, dynamic>>> costCorrections() => getRows('/v1/rekap/cost-corrections');

  // --- sales (admin actions + bon) ---
  Future<Object?> payBon(int saleId, num jumlah, String? keterangan) => post('/v1/sales/$saleId/bon-payments', {'jumlah': jumlah, 'keterangan': keterangan});
  Future<Object?> addItemsToBon(int saleId, List<Map<String, dynamic>> items) => post('/v1/sales/$saleId/items', {'items': items});
  Future<Object?> cancelSale(int saleId) => post('/v1/sales/$saleId/cancel');
  Future<Object?> deleteSale(int saleId) => delete('/v1/sales/$saleId');
  Future<Map<String, dynamic>> purgeTodaySales() async => jsonObject(await post('/v1/sales-purge/today'));
  Future<Map<String, dynamic>> purgeSalesBefore(String before) async => jsonObject(await post('/v1/sales-purge/before', {'before': before}));

  // --- products ---
  Future<Map<String, dynamic>> products(String search, int page, {int pageSize = 25}) =>
      getObject('/v1/products', _q({'search': search, 'page': page, 'pageSize': pageSize}));
  Future<Map<String, dynamic>> product(int id) => getObject('/v1/products/$id');
  Future<Map<String, dynamic>> productByBarcode(String code) => getObject('/v1/products/barcode/${Uri.encodeComponent(code)}');
  Future<Map<String, dynamic>> previewEfisiensiHarga(Map<String, dynamic> body) async =>
      jsonObject(await post('/v1/products/efisiensi-harga/preview', body));
  Future<Map<String, dynamic>> applyEfisiensiHarga(Map<String, dynamic> body) async =>
      jsonObject(await post('/v1/products/efisiensi-harga/apply', body));
  Future<Object?> updateProduct(int id, Map<String, dynamic> body) => put('/v1/products/$id', body);
  Future<Object?> deleteProduct(int id) => delete('/v1/products/$id');
  Future<Map<String, dynamic>> bulkDeleteProducts(List<int> ids) async => jsonObject(await post('/v1/products/bulk-delete', {'ids': ids}));
  Future<List<Map<String, dynamic>>> productsByIds(List<int> ids) async => jsonRows(await post('/v1/products/by-ids', {'ids': ids}));
  Future<Map<String, dynamic>> saveProducts(List<Map<String, dynamic>> rows) async => jsonObject(await post('/v1/products/bulk-save', {'rows': rows}));
  Future<Object?> addUnit(int productId, Map<String, dynamic> body) => post('/v1/products/$productId/units', body);
  Future<Object?> updateUnit(int productId, int unitRowId, Map<String, dynamic> body) => put('/v1/products/$productId/units/$unitRowId', body);
  Future<Object?> deleteUnit(int productId, int unitRowId) => delete('/v1/products/$productId/units/$unitRowId');
  Future<Object?> addTier(int productId, Map<String, dynamic> body) => post('/v1/products/$productId/tiers', body);
  Future<Object?> deleteTier(int productId, int tierId) => delete('/v1/products/$productId/tiers/$tierId');
  Future<Map<String, dynamic>> importProducts(String kind, String fileName, List<int> bytes) async =>
      jsonObject((await file('/v1/products/import/$kind', method: 'POST', query: {'fileName': fileName}, upload: bytes)).json);

  // --- master satuan ---
  Future<List<Map<String, dynamic>>> units() => getRows('/v1/units');
  Future<Object?> createUnit(Map<String, dynamic> body) => post('/v1/units', body);
  Future<Object?> updateUnitMaster(int id, Map<String, dynamic> body) => put('/v1/units/$id', body);
  Future<Object?> deactivateUnit(int id) => delete('/v1/units/$id');

  // --- purchases & supplier debt ---
  Future<Map<String, dynamic>> purchases(int page, {String? dari, String? sampai}) => getObject('/v1/purchases', _q({'page': page, 'dari': dari, 'sampai': sampai}));
  Future<Map<String, dynamic>> purchaseDetail(int id) => getObject('/v1/purchases/$id');
  Future<Object?> deletePurchase(int id) => delete('/v1/purchases/$id');
  Future<List<Map<String, dynamic>>> supplierDebts() => getRows('/v1/supplier-debts');
  Future<List<Map<String, dynamic>>> supplierPayments(int supplierId) => getRows('/v1/supplier-payments', {'supplierId': '$supplierId'});
  Future<Object?> paySupplier(Map<String, dynamic> body) => post('/v1/supplier-payments', body);
  Future<Object?> updateSupplierPayment(int id, Map<String, dynamic> body) => put('/v1/supplier-payments/$id', body);
  Future<Object?> deleteSupplierPayment(int id) => delete('/v1/supplier-payments/$id');
  Future<Object?> setSisaHutang(int purchaseId, num sisa) => put('/v1/purchases/$purchaseId/sisa-hutang', {'sisa': sisa});

  // --- parties ---
  Future<Map<String, dynamic>> supplierList(String search, int page) => getObject('/v1/suppliers', _q({'q': search, 'page': page}));
  Future<Object?> updateSupplier(int id, Map<String, dynamic> body) => put('/v1/suppliers/$id', body);
  Future<Object?> deleteSupplier(int id) => delete('/v1/suppliers/$id');
  Future<Map<String, dynamic>> customerList(String search, int page) => getObject('/v1/customer-master', _q({'search': search, 'page': page}));
  Future<Object?> createCustomer(Map<String, dynamic> body) => post('/v1/customer-master', body);
  Future<Object?> updateCustomer(int id, Map<String, dynamic> body) => put('/v1/customer-master/$id', body);
  Future<Object?> deleteCustomer(int id) => delete('/v1/customer-master/$id');

  // --- cash expenses ---
  Future<Map<String, dynamic>> expenses({String? from, String? to, String? q, int page = 1}) =>
      getObject('/v1/expenses', _q({'from': from, 'to': to, 'q': q, 'page': page}));
  Future<Object?> createExpense(Map<String, dynamic> body) => post('/v1/expenses', body);
  Future<Object?> updateExpense(int id, Map<String, dynamic> body) => put('/v1/expenses/$id', body);
  Future<Object?> deleteExpense(int id) => delete('/v1/expenses/$id');
  Future<FileResponse> expensesExport({String? from, String? to, String? q}) => file('/v1/expenses/export', query: _q({'from': from, 'to': to, 'q': q}));

  // --- stock ledger ---
  Future<Map<String, dynamic>> stockMovements({String? q, String? type, String? dari, String? sampai, int page = 1}) =>
      getObject('/v1/stock-movements', _q({'q': q, 'movementType': type, 'dari': dari, 'sampai': sampai, 'page': page}));

  // --- users, devices, settings ---
  Future<List<Map<String, dynamic>>> users() => getRows('/v1/users');
  Future<Object?> createUser(Map<String, dynamic> body) => post('/v1/users', body);
  Future<Object?> updateUser(int id, Map<String, dynamic> body) => put('/v1/users/$id', body);
  Future<Object?> deleteUser(int id) => delete('/v1/users/$id');
  Future<Map<String, dynamic>> pairingCode() async => jsonObject(await post('/v1/devices/pairing-code'));
  Future<List<Map<String, dynamic>>> devices() => getRows('/v1/devices');
  Future<Object?> revokeDevice(int id) => delete('/v1/devices/$id');

  // --- access from outside the shop (Tailscale) ---
  Future<Map<String, dynamic>> remoteAccess() => getObject('/v1/remote-access');
  Future<Object?> enableRemote(String clientId, String clientSecret) => put('/v1/remote-access', {'clientId': clientId, 'clientSecret': clientSecret});
  Future<Object?> disableRemote() => delete('/v1/remote-access');
  Future<Map<String, dynamic>> settings() => getObject('/v1/settings');
  Future<Object?> saveSettings(Map<String, dynamic> body) => put('/v1/settings', body);
  Future<List<Map<String, dynamic>>> printers() => getRows('/v1/printers');
  Future<Object?> testPrint() => post('/v1/printers/test');
}
