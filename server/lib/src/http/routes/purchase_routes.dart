import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../../core/errors.dart';
import '../../core/money.dart';
import '../../domain/parties.dart';
import '../../domain/purchase.dart';
import '../../domain/stock.dart';
import '../api.dart';

PurchaseInput _purchaseInput(Map<String, Object?> body, int userId) => PurchaseInput(
      supplierId: body.intOr('supplierId'),
      tanggal: body.string('tanggal'),
      catatan: body.stringOr('catatan'),
      userId: userId,
      // null means the whole invoice was settled; 0 means all of it is owed
      dibayar: body.numOr('dibayar') == null ? null : toCents(body.number('dibayar')),
      items: [
        for (final item in body.objects('items'))
          PurchaseItemInput(
            productId: item.integer('productId'),
            productUnitId: item.intOr('productUnitId'),
            qty: item.number('qty'),
            hargaBeli: toCents(item.number('hargaBeli')),
            hargaJual: item.numOr('hargaJual') == null ? null : toCents(item.number('hargaJual')),
          ),
      ],
    );

PartyInput _party(Map<String, Object?> body) => PartyInput(
      nama: body.stringOr('nama') ?? '',
      telepon: body.stringOr('telepon'),
      alamat: body.stringOr('alamat'),
      keterangan: body.stringOr('keterangan'),
    );

void addPurchaseRoutes(Router router, ApiContext ctx) {
  final db = ctx.db;

  // --- suppliers ---

  router.get('/v1/suppliers', (Request request) {
    requireUser(ctx, request);

    return json(listSuppliers(db, search: request.query('q') ?? request.query('search'), page: request.queryInt('page'), pageSize: request.queryIntOr('pageSize')));
  });

  router.post('/v1/suppliers', (Request request) async {
    requireUser(ctx, request);
    final body = await readJson(request);

    if ((body.stringOr('nama') ?? '').isEmpty) {
      throw BadRequest('nama wajib diisi.');
    }

    return json({'id': createSupplier(db, _party(body))});
  });

  router.put('/v1/suppliers/<id>', (Request request) async {
    requireUser(ctx, request);
    updateSupplier(db, pathInt(request, 'id'), _party(await readJson(request)));

    return ok();
  });

  router.delete('/v1/suppliers/<id>', (Request request) {
    requireAdmin(ctx, request);
    deleteSupplier(db, pathInt(request, 'id'));

    return ok();
  });

  // --- customer master (the till's picker reads /v1/customers) ---

  router.get('/v1/customer-master', (Request request) {
    requireUser(ctx, request);

    return json(listCustomers(db, search: request.query('search') ?? request.query('q'), page: request.queryInt('page'), pageSize: request.queryIntOr('pageSize')));
  });

  router.post('/v1/customer-master', (Request request) async {
    requireUser(ctx, request);

    return json({'id': createCustomer(db, _party(await readJson(request)))});
  });

  router.put('/v1/customer-master/<id>', (Request request) async {
    requireUser(ctx, request);
    updateCustomer(db, pathInt(request, 'id'), _party(await readJson(request)));

    return ok();
  });

  router.delete('/v1/customer-master/<id>', (Request request) {
    requireAdmin(ctx, request);
    deleteCustomer(db, pathInt(request, 'id'));

    return ok();
  });

  // --- purchases ---

  router.get('/v1/purchases/products', (Request request) {
    requireUser(ctx, request);

    return json({'data': searchProductsForPurchase(db, request.query('q') ?? '')});
  });

  router.get('/v1/purchases/products/barcode/<code>', (Request request) {
    requireUser(ctx, request);
    final product = findProductForPurchaseByBarcode(db, Uri.decodeComponent(request.params['code']!));

    if (product == null) {
      throw NotFoundException('Produk tidak ditemukan.');
    }

    return json(product);
  });

  router.get('/v1/purchases', (Request request) {
    requireUser(ctx, request);

    return json(listPurchases(db, page: request.queryInt('page'), pageSize: request.queryIntOr('pageSize'), dari: request.query('dari'), sampai: request.query('sampai'), search: request.query('q')));
  });

  router.post('/v1/purchases', (Request request) async {
    final user = requireUser(ctx, request);
    final body = await readJson(request);

    if (body['tanggal'] == null || body['items'] == null) {
      throw BadRequest('tanggal dan items wajib diisi.');
    }

    return json({'purchaseId': recordPurchase(db, _purchaseInput(body, user.id))});
  });

  router.get('/v1/purchases/<id>', (Request request) {
    requireUser(ctx, request);

    return json(getPurchaseDetail(db, pathInt(request, 'id')));
  });

  router.put('/v1/purchases/<id>', (Request request) async {
    final user = requireUser(ctx, request);
    final total = updatePurchase(db, pathInt(request, 'id'), _purchaseInput(await readJson(request), user.id));

    return json({'total': rupiahJson(total)});
  });

  router.delete('/v1/purchases/<id>', (Request request) {
    requireUser(ctx, request);
    deletePurchase(db, pathInt(request, 'id'));

    return ok();
  });

  router.put('/v1/purchases/<id>/sisa-hutang', (Request request) async {
    requireUser(ctx, request);
    updatePurchaseSisaHutang(db, pathInt(request, 'id'), toCents((await readJson(request)).number('sisa')));

    return ok();
  });

  // --- supplier debt ---

  router.get('/v1/supplier-debts', (Request request) {
    requireUser(ctx, request);

    return json({'data': listSupplierDebts(db, request.queryIntOr('supplierId'))});
  });

  router.get('/v1/supplier-payments', (Request request) {
    requireUser(ctx, request);
    final supplierId = request.queryIntOr('supplierId');

    if (supplierId == null) {
      throw BadRequest('supplierId wajib diisi.');
    }

    return json({'data': listSupplierPayments(db, supplierId)});
  });

  router.post('/v1/supplier-payments', (Request request) async {
    final user = requireUser(ctx, request);
    final body = await readJson(request);
    final alokasi = recordSupplierPayment(
      db,
      supplierId: body.integer('supplierId'),
      jumlah: toCents(body.number('jumlah')),
      tanggal: body.string('tanggal'),
      keterangan: body.stringOr('keterangan'),
      userId: user.id,
    );

    return json({
      'alokasi': [for (final part in alokasi) {'purchaseId': part.purchaseId, 'jumlah': rupiahJson(part.jumlah)}],
    });
  });

  router.put('/v1/supplier-payments/<id>', (Request request) async {
    requireUser(ctx, request);
    final body = await readJson(request);

    updateSupplierPayment(db, pathInt(request, 'id'), jumlah: toCents(body.number('jumlah')), tanggal: body.string('tanggal'), keterangan: body.stringOr('keterangan'));

    return ok();
  });

  router.delete('/v1/supplier-payments/<id>', (Request request) {
    requireUser(ctx, request);
    deleteSupplierPayment(db, pathInt(request, 'id'));

    return ok();
  });

  // --- stock opname ---

  router.get('/v1/opname/categories', (Request request) {
    requireUser(ctx, request);

    return json({'data': listCategories(db)});
  });

  router.get('/v1/opname/products', (Request request) {
    requireUser(ctx, request);
    final categoryIds = [
      for (final part in (request.query('categoryIds') ?? '').split(','))
        if (int.tryParse(part.trim()) != null) int.parse(part.trim()),
    ];

    return json({'data': searchProductsForOpname(db, q: request.query('q') ?? '', categoryIds: categoryIds)});
  });

  router.post('/v1/opname/adjustments', (Request request) async {
    final user = requireUser(ctx, request);
    final body = await readJson(request);

    if (body['productId'] == null || body['stokSesudah'] == null) {
      throw BadRequest('productId dan stokSesudah wajib diisi.');
    }

    final id = recordStockAdjustment(
      db,
      productId: body.integer('productId'),
      stokSesudah: body.number('stokSesudah'),
      alasan: body.stringOr('alasan'),
      userId: user.id,
      expectedStock: body.numOr('expectedStock'),
      expectedRevision: body.intOr('expectedRevision'),
    );

    return json({'id': id});
  });

  router.get('/v1/stock-movements', (Request request) {
    requireUser(ctx, request);
    final type = request.query('movementType');

    if (type != null && !movementTypes.contains(type)) {
      throw BadRequest('movementType tidak valid.');
    }

    return json(listStockMovements(
      db,
      q: request.query('q'),
      movementType: type,
      dari: request.query('dari'),
      sampai: request.query('sampai'),
      page: request.queryInt('page'),
      pageSize: request.queryIntOr('pageSize'),
    ));
  });
}
