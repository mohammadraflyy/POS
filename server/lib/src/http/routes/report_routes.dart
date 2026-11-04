import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../../core/money.dart';
import '../../core/spreadsheet.dart';
import '../../domain/cost_correction.dart';
import '../../domain/expense.dart';
import '../../domain/rekap.dart';
import '../../domain/settings.dart';
import '../../printing/escpos.dart';
import '../api.dart';

const _xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

ExpenseInput _expense(Map<String, Object?> body) => ExpenseInput(
      tanggal: body.stringOr('tanggal') ?? '',
      kategori: body.stringOr('kategori') ?? '',
      jumlah: toCents(body.numOr('jumlah') ?? 0),
      keterangan: body.stringOr('keterangan'),
    );

({String from, String to}) _range(Request request) {
  final from = request.query('from');
  final to = request.query('to');

  if (from == null || to == null || DateTime.tryParse(from) == null || DateTime.tryParse(to) == null) {
    throw BadRequest('from dan to wajib diisi dengan format YYYY-MM-DD.');
  }

  return (from: from, to: to);
}

CostCorrectionRequest _correction(Map<String, Object?> body) => CostCorrectionRequest(
      saleItemId: body.integer('saleItemId'),
      scope: body.string('scope'),
      from: body.stringOr('from') ?? '',
      to: body.stringOr('to') ?? '',
      hargaPokok: body.number('hargaPokok'),
    );

/// Dashboard, rekap, cash expenses, settings and printers.
void addReportRoutes(Router router, ApiContext ctx) {
  final db = ctx.db;

  router.get('/v1/dashboard', (Request request) {
    requireUser(ctx, request);

    return json(getDashboard(db));
  });

  router.get('/v1/rekap', (Request request) {
    requireAdmin(ctx, request);
    final range = _range(request);

    return json(getRekap(db, from: range.from, to: range.to));
  });

  router.get('/v1/rekap/export', (Request request) {
    requireAdmin(ctx, request);
    final range = _range(request);

    return file(buildRekapWorkbook(getRekap(db, from: range.from, to: range.to)), 'rekap-${range.from}-${range.to}.xlsx', _xlsx);
  });

  router.post('/v1/rekap/cost-corrections/preview', (Request request) async {
    final admin = requireAdmin(ctx, request);

    return json(previewCostCorrection(db, admin, _correction(await readJson(request))));
  });

  router.post('/v1/rekap/cost-corrections', (Request request) async {
    final admin = requireAdmin(ctx, request);
    final body = await readJson(request);
    final count = applyCostCorrection(db, admin, _correction(body), token: body.string('token'), alasan: body.stringOr('alasan') ?? '');

    return json({'count': count});
  });

  router.get('/v1/rekap/cost-corrections', (Request request) {
    final admin = requireAdmin(ctx, request);

    return json({'data': listCostCorrections(db, admin)});
  });

  // --- pengeluaran ---

  router.get('/v1/expenses', (Request request) {
    requireUser(ctx, request);

    return json(listCashExpenses(db, from: request.query('from'), to: request.query('to'), q: request.query('q'), page: request.queryInt('page'), pageSize: request.queryIntOr('pageSize')));
  });

  router.get('/v1/expenses/export', (Request request) {
    requireAdmin(ctx, request);
    final rows = listAllCashExpenses(db, from: request.query('from'), to: request.query('to'), q: request.query('q'));
    final bytes = buildWorkbook([
      SheetSpec(
        name: 'Pengeluaran',
        headers: const ['Tanggal', 'Kategori', 'Jumlah', 'Keterangan', 'Dicatat Oleh'],
        rows: [
          for (final row in rows) [row['tanggal'], row['kategori'], row['jumlah'], row['keterangan'] ?? '-', row['userName'] ?? '-'],
        ],
      ),
    ]);

    return file(bytes, 'pengeluaran.xlsx', _xlsx);
  });

  router.post('/v1/expenses', (Request request) async {
    final user = requireUser(ctx, request);

    return json({'expenseId': recordCashExpense(db, _expense(await readJson(request)), userId: user.id)});
  });

  // editing and deleting rewrite the cash record, so both stay with the owner
  router.put('/v1/expenses/<id>', (Request request) async {
    requireAdmin(ctx, request);
    updateCashExpense(db, pathInt(request, 'id'), _expense(await readJson(request)));

    return ok();
  });

  router.delete('/v1/expenses/<id>', (Request request) {
    requireAdmin(ctx, request);
    deleteCashExpense(db, pathInt(request, 'id'));

    return ok();
  });

  // --- settings and printers ---

  router.get('/v1/settings', (Request request) {
    requireUser(ctx, request);

    return json(getStoreSettings(db));
  });

  router.put('/v1/settings', (Request request) async {
    requireAdmin(ctx, request);
    final body = await readJson(request);

    updateStoreSettings(
      db,
      namaToko: body.stringOr('namaToko') ?? '',
      alamat: body.stringOr('alamat'),
      telepon: body.stringOr('telepon'),
      pesanFooter: body.stringOr('pesanFooter'),
      printerName: body.stringOr('printerName'),
      receiptWidth: body.stringOr('receiptWidth') ?? '58mm',
      marginMinimalPersen: body.numOr('marginMinimalPersen'),
    );

    return ok();
  });

  router.get('/v1/printers', (Request request) async {
    requireUser(ctx, request);

    return json({'data': [for (final printer in await ctx.receipts.printer.listPrinters()) printer.toJson()]});
  });

  router.post('/v1/printers/test', (Request request) async {
    requireUser(ctx, request);
    await ctx.receipts.printTest();

    return json({'printed': true});
  });

  // the sample struk as bytes, for checking the layout without a printer
  router.get('/v1/printers/sample', (Request request) {
    requireUser(ctx, request);
    final settings = getStoreSettings(db);

    return file(
      buildReceiptEscPos(sampleReceipt(), StoreInfo(namaToko: settings['namaToko'] as String), PaperWidth.parse(settings['receiptWidth'])),
      'contoh-struk.bin',
      'application/octet-stream',
    );
  });
}

/// The rekap as an Excel workbook: one sheet per breakdown, each with a merged title row.
List<int> buildRekapWorkbook(Map<String, Object?> rekap) {
  List<Map<String, Object?>> rows(Object? value) => (value as List).cast<Map<String, Object?>>();

  final stockValue = rekap['stockValue'] as Map<String, Object?>;

  return buildWorkbook([
    SheetSpec(
      name: 'Riwayat Transaksi',
      title: 'Riwayat Transaksi',
      headers: const ['Tanggal', 'Pelanggan', 'Metode', 'Status', 'Total', 'Dibayar'],
      rows: [
        for (final row in rows(rekap['salesHistory']))
          [formatTanggal(DateTime.parse(row['createdAt'] as String)), row['namaPelanggan'] ?? '-', row['metodePembayaran'], row['status'], row['total'], row['dibayar']],
      ],
    ),
    SheetSpec(
      name: 'Laba per Kategori',
      title: 'Laba per Kategori',
      headers: const ['Kategori', 'Omzet', 'Laba'],
      rows: [for (final row in rows(rekap['labaPerKategori'])) [row['categoryName'], row['omzet'], row['laba']]],
    ),
    SheetSpec(
      name: 'Laba per Hari',
      title: 'Laba per Hari',
      headers: const ['Tanggal', 'Omzet', 'Laba'],
      rows: [for (final row in rows(rekap['labaPerHari'])) [row['tanggal'], row['omzet'], row['laba']]],
    ),
    SheetSpec(
      name: 'Laba per Satuan',
      title: 'Laba per Satuan',
      headers: const ['Satuan', 'Qty Terjual', 'Omzet', 'Laba', 'Margin %'],
      rows: [
        for (final row in rows(rekap['labaPerSatuan']))
          [row['satuan'], row['qtyTerjual'], row['omzet'], row['laba'], double.parse((row['marginPersen'] as num).toStringAsFixed(2))],
      ],
    ),
    SheetSpec(
      name: 'Produk Terlaris',
      title: 'Produk Terlaris',
      headers: const ['Produk', 'Qty Terjual', 'Total Penjualan'],
      rows: [for (final row in rows(rekap['produkTerlaris'])) [row['namaItem'], row['qtyTerjual'], row['totalPenjualan']]],
    ),
    SheetSpec(
      name: 'Pembelian per Supplier',
      title: 'Pembelian per Supplier',
      headers: const ['Supplier', 'Total Pembelian'],
      rows: [for (final row in rows(rekap['pembelianPerSupplier'])) [row['supplierName'], row['totalPembelian']]],
    ),
    SheetSpec(
      name: 'Piutang per Pelanggan',
      title: 'Piutang per Pelanggan',
      headers: const ['Pelanggan', 'Telepon', 'Jumlah Bon Belum Lunas', 'Total Piutang'],
      rows: [for (final row in rows(rekap['piutangPerPelanggan'])) [row['namaPelanggan'], row['telepon'] ?? '-', row['jumlahBon'], row['totalPiutang']]],
    ),
    SheetSpec(
      name: 'Nilai Stock',
      title: 'Nilai Stock',
      headers: const ['Kode Item', 'Produk', 'Stok', 'Satuan', 'Harga Pokok', 'Nilai'],
      rows: [
        for (final row in rows(stockValue['produk'])) [row['kodeItem'], row['namaItem'], row['stok'], row['satuan'], row['hargaPokok'], row['nilai']],
      ],
    ),
  ]);
}
