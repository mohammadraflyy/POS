import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../../core/errors.dart';
import '../../core/money.dart';
import '../../core/spreadsheet.dart';
import '../../domain/harga_efisiensi.dart';
import '../../domain/inventory.dart';
import '../../domain/inventory_units.dart';
import '../../domain/master_satuan.dart';
import '../api.dart';

const _maxUploadBytes = 20 * 1024 * 1024;

/// An uploaded spreadsheet: the raw file as the request body, its name in `?fileName=`
/// (the extension decides how it is read).
Future<SheetRows> _uploadedSheet(Request request) async {
  final fileName = request.query('fileName') ?? request.headers['x-file-name'];

  if (fileName == null) {
    throw BadRequest('fileName wajib diisi, misalnya ?fileName=produk.xlsx');
  }

  final bytes = <int>[];

  await for (final chunk in request.read()) {
    bytes.addAll(chunk);

    if (bytes.length > _maxUploadBytes) {
      throw BadRequest('File terlalu besar (maksimal 20 MB).');
    }
  }

  if (bytes.isEmpty) {
    throw BadRequest('File kosong.');
  }

  return readSheetRows(bytes, fileName);
}

/// A nominal raise arrives in rupiah and becomes cents; a percentage stays a percentage.
FilterEfisiensi _filterEfisiensi(Map<String, Object?> body) {
  final metode = body.string('metode');
  final nilai = body.numOr('nilai');

  return FilterEfisiensi(
    cakupan: body.string('cakupan'),
    metode: metode,
    nilai: nilai == null ? null : (metode == 'nominal' ? toCents(nilai) : nilai),
    categoryId: body.intOr('categoryId'),
  );
}

void addInventoryRoutes(Router router, ApiContext ctx) {
  final db = ctx.db;

  router.get('/v1/products', (Request request) {
    requireUser(ctx, request);

    return json(listProducts(db, search: request.query('search') ?? request.query('q'), page: request.queryInt('page'), pageSize: request.queryIntOr('pageSize')));
  });

  router.get('/v1/products/search', (Request request) {
    requireUser(ctx, request);

    return json({'data': searchProductsQuick(db, request.query('q') ?? '')});
  });

  router.get('/v1/products/barcode/<code>', (Request request) {
    requireUser(ctx, request);
    final product = findProductByBarcode(db, Uri.decodeComponent(request.params['code']!));

    if (product == null) {
      throw NotFoundException('Produk tidak ditemukan.');
    }

    return json(product);
  });

  router.post('/v1/products/by-ids', (Request request) async {
    requireUser(ctx, request);

    return json({'data': getProductsByIds(db, (await readJson(request)).ints('ids'))});
  });

  // the mass-input grid: every row valid and saved, or nothing saved and per-row errors back
  router.post('/v1/products/bulk-save', (Request request) async {
    final admin = requireAdmin(ctx, request);
    final body = await readJson(request);
    final rows = [
      for (final row in body.objects('rows'))
        BulkSaveRow(
          key: row.string('key'),
          id: row.intOr('id'),
          kodeItem: row.stringOr('kodeItem') ?? '',
          barcode: row.stringOr('barcode'),
          namaItem: row.stringOr('namaItem') ?? '',
          kategori: row.stringOr('kategori'),
          satuan: row.stringOr('satuan') ?? '',
          hargaPokok: toCents(row.numOr('hargaPokok') ?? -1),
          hargaJual: toCents(row.numOr('hargaJual') ?? -1),
          stok: row.numOr('stok') ?? 0,
        ),
    ];

    return json(bulkSaveProducts(db, rows, userId: admin.id));
  });

  router.post('/v1/products/bulk-delete', (Request request) async {
    requireAdmin(ctx, request);

    return json(bulkDeleteProducts(db, (await readJson(request)).ints('ids')));
  });

  for (final (path, importer) in [
    ('products', (SheetRows rows, int userId) => importProducts(db, rows, userId: userId)),
    ('satuan', (SheetRows rows, int userId) => importSatuan(db, rows)),
    ('harga-bertingkat', (SheetRows rows, int userId) => importHargaBertingkat(db, rows)),
    ('barcode', (SheetRows rows, int userId) => importBarcode(db, rows)),
  ]) {
    router.post('/v1/products/import/$path', (Request request) async {
      final admin = requireAdmin(ctx, request);

      return json(importer(await _uploadedSheet(request), admin.id));
    });
  }

  router.post('/v1/products/efisiensi-harga/preview', (Request request) async {
    requireAdmin(ctx, request);

    return json(rencanakanEfisiensiHarga(db, _filterEfisiensi(await readJson(request))));
  });

  // `pilihan` null applies the whole plan; otherwise only the ticked satuan and tier ids
  router.post('/v1/products/efisiensi-harga/apply', (Request request) async {
    final admin = requireAdmin(ctx, request);
    final body = await readJson(request);
    final filter = body['filter'];
    final pilihan = body['pilihan'] is Map ? (body['pilihan'] as Map).cast<String, Object?>() : null;

    if (filter is! Map) {
      throw BadRequest('filter wajib diisi.');
    }

    return json(terapkanEfisiensiHarga(
      db,
      _filterEfisiensi(filter.cast<String, Object?>()),
      pilihSemua: pilihan == null,
      satuanIds: pilihan?.ints('satuanIds'),
      tierIds: pilihan?.ints('tierIds'),
      userId: admin.id,
    ));
  });

  router.get('/v1/products/<id>', (Request request) {
    requireUser(ctx, request);

    return json(getProductDetail(db, pathInt(request, 'id')));
  });

  router.put('/v1/products/<id>', (Request request) async {
    final admin = requireAdmin(ctx, request);
    final body = await readJson(request);

    updateProduct(
      db,
      pathInt(request, 'id'),
      ProductInput(
        kodeItem: body.stringOr('kodeItem') ?? '',
        barcode: body.stringOr('barcode'),
        namaItem: body.stringOr('namaItem') ?? '',
        kategori: body.stringOr('kategori'),
        satuan: body.stringOr('satuan') ?? '',
        hargaPokok: toCents(body.number('hargaPokok')),
        hargaJual: toCents(body.number('hargaJual')),
        isActive: body.boolOr('isActive') ?? true,
      ),
      userId: admin.id,
    );

    return ok();
  });

  router.delete('/v1/products/<id>', (Request request) {
    requireAdmin(ctx, request);
    deleteProduct(db, pathInt(request, 'id'));

    return ok();
  });

  // --- units and price tiers of one product ---

  router.post('/v1/products/<id>/units', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);
    final id = addProductUnit(
      db,
      pathInt(request, 'id'),
      unitId: body.integer('unitId'),
      jumlahKemasan: body.integer('jumlahKemasan'),
      hargaJual: toCents(body.number('hargaJual')),
      hargaPokok: body.numOr('hargaPokok') == null ? null : toCents(body.number('hargaPokok')),
      // omitted stacks on the largest unit; null hangs it on the base
      parentUnitId: body.has('parentUnitId') ? body.intOr('parentUnitId') : unset,
    );

    return json({'id': id});
  });

  router.put('/v1/products/<id>/units/<unitRowId>', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);

    updateProductUnit(
      db,
      pathInt(request, 'id'),
      pathInt(request, 'unitRowId'),
      unitId: body.integer('unitId'),
      jumlahKemasan: body.integer('jumlahKemasan'),
      hargaJual: toCents(body.number('hargaJual')),
      hargaPokok: body.numOr('hargaPokok') == null ? null : toCents(body.number('hargaPokok')),
      parentUnitId: body.has('parentUnitId') ? body.intOr('parentUnitId') : unset,
    );

    return ok();
  });

  router.delete('/v1/products/<id>/units/<unitRowId>', (Request request) {
    requireAdmin(ctx, request);
    deleteProductUnit(db, pathInt(request, 'id'), pathInt(request, 'unitRowId'));

    return ok();
  });

  router.post('/v1/products/<id>/tiers', (Request request) async {
    requireAdmin(ctx, request);
    final productId = pathInt(request, 'id');
    final body = await readJson(request);
    final id = addPriceTier(
      db,
      productId,
      // an omitted unit means the base one
      body.intOr('productUnitId') ?? getBaseProductUnit(db, productId).id,
      minQty: body.integer('minQty'),
      maxQty: body.intOr('maxQty'),
      hargaJual: toCents(body.number('hargaJual')),
    );

    return json({'id': id});
  });

  router.delete('/v1/products/<id>/tiers/<tierId>', (Request request) {
    requireAdmin(ctx, request);
    deletePriceTier(db, pathInt(request, 'id'), pathInt(request, 'tierId'));

    return ok();
  });

  // --- master satuan ---

  router.get('/v1/units', (Request request) {
    requireUser(ctx, request);

    return json({'data': listUnits(db)});
  });

  router.post('/v1/units', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);

    return json({'id': createUnit(db, code: body.stringOr('code') ?? '', name: body.stringOr('name') ?? '', symbol: body.stringOr('symbol') ?? '')});
  });

  router.put('/v1/units/<id>', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);

    updateUnit(db, pathInt(request, 'id'),
        code: body.stringOr('code') ?? '', name: body.stringOr('name') ?? '', symbol: body.stringOr('symbol') ?? '', isActive: body.boolOr('isActive') ?? true);

    return ok();
  });

  router.delete('/v1/units/<id>', (Request request) {
    requireAdmin(ctx, request);
    deactivateUnit(db, pathInt(request, 'id'));

    return ok();
  });
}
