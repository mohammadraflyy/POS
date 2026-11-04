import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../../core/errors.dart';
import '../../core/money.dart';
import '../../domain/kasir.dart';
import '../../domain/parties.dart';
import '../api.dart';

/// Cart lines arrive in rupiah; domain code works in cents.
List<CartItemInput> _cartItems(Map<String, Object?> body, {String key = 'items'}) => [
      for (final item in body.objects(key))
        CartItemInput(
          productId: item.integer('productId'),
          productUnitId: item.intOr('productUnitId'),
          qty: item.number('qty'),
          hargaJual: item.numOr('hargaJual') == null ? null : toCents(item.number('hargaJual')),
          diskon: item.numOr('diskon') == null ? null : toCents(item.number('diskon')),
        ),
    ];

int? _centsOr(Map<String, Object?> body, String key) => body.numOr(key) == null ? null : toCents(body.number(key));

void addSalesRoutes(Router router, ApiContext ctx) {
  final db = ctx.db;

  // names only, for the till's customer picker
  router.get('/v1/customers', (Request request) {
    requireUser(ctx, request);

    return json({'names': listCustomerNames(db)});
  });

  router.get('/v1/catalog/search', (Request request) {
    requireUser(ctx, request);

    return json(searchCatalogForSale(db, q: request.query('q'), page: request.queryInt('page'), pageSize: request.queryIntOr('pageSize')));
  });

  // every active product with its units and tiers, for a till that keeps the catalog in memory
  router.get('/v1/kasir/products', (Request request) {
    requireUser(ctx, request);

    return json({'data': listProductsForKasir(db)});
  });

  // Stateless: the client sends the whole cart every time it changes and gets back the
  // server's pricing. A short line comes back flagged `stokCukup: false`, not as an error.
  router.post('/v1/carts/price', (Request request) async {
    requireUser(ctx, request);
    final body = await readJson(request);

    if (body['items'] == null) {
      throw BadRequest('items wajib diisi.');
    }

    return json(previewCart(db, _cartItems(body), diskonNota: _centsOr(body, 'diskonNota')));
  });

  router.post('/v1/sales', (Request request) async {
    final user = requireUser(ctx, request);
    final body = await readJson(request);

    if (body['metodePembayaran'] == null || body['items'] == null) {
      throw BadRequest('metodePembayaran dan items wajib diisi.');
    }

    final result = checkout(
      db,
      CheckoutInput(
        metodePembayaran: MetodePembayaran.parse(body['metodePembayaran']),
        namaPelanggan: body.stringOr('namaPelanggan'),
        dibayar: _centsOr(body, 'dibayar'),
        userId: user.id,
        tanggal: body.stringOr('tanggal'),
        diskon: _centsOr(body, 'diskon'),
        biayaLain: _centsOr(body, 'biayaLain'),
        keterangan: body.stringOr('keterangan'),
        items: _cartItems(body),
      ),
    );

    // the sale is already committed - a printer problem must never look like it failed.
    // `cetak: false` (the desktop contract; `print` is the older spelling) skips the
    // receipt on purpose, answered as printSkipped so the phone does not show an error.
    final printSkipped = (body.boolOr('cetak') ?? body.boolOr('print') ?? true) == false;
    String? printError;

    if (!printSkipped) {
      try {
        await ctx.receipts.printSale(result.saleId);
      } on Object catch (error) {
        printError = error is BusinessException ? error.message : 'Gagal mencetak struk: $error';
      }
    }

    return json({
      'saleId': result.saleId,
      'total': rupiahJson(result.total),
      'printed': !printSkipped && printError == null,
      'printError': ?printError,
      'printSkipped': printSkipped,
    });
  });

  router.get('/v1/sales', (Request request) {
    requireUser(ctx, request);

    return json(listSalesHistory(
      db,
      dari: request.query('dari'),
      sampai: request.query('sampai'),
      status: request.query('status'),
      metodePembayaran: request.query('metodePembayaran'),
      search: request.query('search'),
      page: request.queryInt('page'),
    ));
  });

  router.get('/v1/sales/<id>', (Request request) {
    requireUser(ctx, request);

    return json(getSaleDetail(db, pathInt(request, 'id')));
  });

  router.post('/v1/sales/<id>/print', (Request request) async {
    requireUser(ctx, request);
    final saleId = pathInt(request, 'id');

    getSaleDetail(db, saleId);
    await ctx.receipts.printSale(saleId);

    return json({'printed': true});
  });

  // the raw struk bytes, for a client that prints to its own printer
  router.get('/v1/sales/<id>/receipt', (Request request) {
    requireUser(ctx, request);
    final saleId = pathInt(request, 'id');

    return file(ctx.receipts.buildForSale(saleId), 'struk-$saleId.bin', 'application/octet-stream');
  });

  router.post('/v1/sales/<id>/bon-payments', (Request request) async {
    requireUser(ctx, request);
    final body = await readJson(request);

    recordBonPayment(db, pathInt(request, 'id'), toCents(body.number('jumlah')), body.stringOr('keterangan'));

    return ok();
  });

  router.post('/v1/sales/<id>/items', (Request request) async {
    requireUser(ctx, request);
    final body = await readJson(request);
    final total = addItemsToSale(db, pathInt(request, 'id'), _cartItems(body));

    return json({'total': rupiahJson(total)});
  });

  // --- admin: rewriting a saved sale moves the rekap and the cash book on two days ---

  router.get('/v1/sales/<id>/edit', (Request request) {
    requireAdmin(ctx, request);

    return json(getSaleForEdit(db, pathInt(request, 'id')));
  });

  router.put('/v1/sales/<id>', (Request request) async {
    final admin = requireAdmin(ctx, request);
    final body = await readJson(request);
    final total = updateSale(
      db,
      pathInt(request, 'id'),
      UpdateSaleInput(
        metodePembayaran: MetodePembayaran.parse(body['metodePembayaran']),
        namaPelanggan: body.stringOr('namaPelanggan'),
        dibayar: _centsOr(body, 'dibayar'),
        tanggal: body.string('tanggal'),
        userId: admin.id,
        diskon: _centsOr(body, 'diskon'),
        biayaLain: _centsOr(body, 'biayaLain'),
        keterangan: body.stringOr('keterangan'),
        items: _cartItems(body),
      ),
    );

    return json({'total': rupiahJson(total)});
  });

  router.post('/v1/sales/<id>/cancel', (Request request) {
    requireAdmin(ctx, request);
    cancelSale(db, pathInt(request, 'id'));

    return ok();
  });

  router.delete('/v1/sales/<id>', (Request request) {
    requireAdmin(ctx, request);
    deleteSale(db, pathInt(request, 'id'));

    return ok();
  });

  router.post('/v1/sales-purge/today', (Request request) {
    requireAdmin(ctx, request);

    return json(purgeTodaySales(db));
  });

  router.post('/v1/sales-purge/before', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);
    final before = DateTime.tryParse('${body.string('before')}T00:00:00');

    if (before == null) {
      throw BadRequest('before harus berupa tanggal YYYY-MM-DD.');
    }

    return json({'deleted': purgeSalesBefore(db, before)});
  });
}
