import 'dart:convert';
import 'dart:io';

import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/printing/escpos.dart';
import 'package:pos_server/src/printing/printer.dart';
import 'package:test/test.dart';

String text(List<int> bytes) => latin1.decode(bytes);

ReceiptSale sale({String metode = 'tunai', num dibayar = 30000, num diskon = 0, num biayaLain = 0, String? keterangan, List<ReceiptItem>? items}) => ReceiptSale(
      saleId: 41,
      diskon: diskon,
      total: 25000 - diskon + biayaLain,
      dibayar: dibayar,
      biayaLain: biayaLain,
      metodePembayaran: metode,
      namaPelanggan: 'Bu Rina',
      createdAt: DateTime(2026, 10, 13, 19, 9),
      kasirName: 'Admin',
      keterangan: keterangan,
      items: items ??
          const [
            ReceiptItem(namaItem: 'Beras', qty: 2.5, satuan: 'KG', hargaJual: 10000, diskon: 0, subtotal: 25000),
          ],
    );

void main() {
  const store = StoreInfo(namaToko: 'Toko Demo', alamat: 'Jl. Mawar 1', pesanFooter: 'Terima kasih');

  test('formats money and quantities the Indonesian way', () {
    expect(formatRupiah(1234567), 'Rp 1.234.567');
    expect(formatRupiah(1000.5), 'Rp 1.000,5');
    expect(formatQty(2.5), '2,5');
    expect(formatQty(1000), '1.000');
    expect(formatTanggal(DateTime(2026, 10, 13, 19, 9)), '13/10/2026, 19.09.00');
  });

  test('lays out a cash struk with change, header and footer', () {
    final out = text(buildReceiptEscPos(sale(), store, PaperWidth.mm58));

    expect(out, contains('Toko Demo'));
    expect(out, contains('Struk #41'));
    expect(out, contains('2,5 KG x Rp 10.000'));
    expect(out, contains('Kembali'));
    expect(out, contains('Rp 5.000'));
    expect(out, contains('Terima kasih'));
    // every printed line fits the 58 mm paper
    for (final line in out.split('\n').map((l) => l.replaceAll(RegExp(r'[\x00-\x1f]'), ''))) {
      expect(line.length, lessThanOrEqualTo(PaperWidth.mm58.chars + 3), reason: line);
    }
  });

  test('shows a bon\'s remaining debt, discounts, charges and a wrapped note', () {
    final out = text(buildReceiptEscPos(
      sale(metode: 'bon', dibayar: 5000, diskon: 1000, biayaLain: 2000, keterangan: 'antar sore ke rumah belakang pasar dekat masjid'),
      store,
      PaperWidth.mm58,
    ));

    expect(out, contains('Bon'));
    expect(out, contains('Rp 21.000'));
    expect(out, contains('Diskon'));
    expect(out, contains('Lain-lain'));
    expect(out, contains('Keterangan:'));
    expect(out, isNot(contains('Kembali')));
  });

  test('ends with a feed and a paper cut', () {
    final bytes = buildReceiptEscPos(sale(), store, PaperWidth.mm80);

    expect(bytes.sublist(bytes.length - 6), [0x1b, 0x64, 3, 0x1d, 0x56, 0x00]);
  });

  test('NoPrinter refuses politely', () async {
    expect(() => const NoPrinter().printRaw(null, [1]), throwsA(isA<BusinessException>()));
  });

  test('the real spooler reports a missing printer as a business error', () async {
    final printer = WindowsSpoolerPrinter(timeout: const Duration(seconds: 10));

    await expectLater(
      printer.printRaw('Printer Yang Tidak Ada 123', [0x1b, 0x40]),
      throwsA(isA<BusinessException>().having((e) => e.message, 'message', contains('tidak bisa dibuka'))),
    );
    // the queue keeps working after a failure
    await expectLater(printer.printRaw('Printer Yang Tidak Ada 456', [0x1b, 0x40]), throwsA(isA<BusinessException>()));
    expect(await printer.listPrinters(), isA<List<PrinterInfo>>());
  }, skip: Platform.isWindows ? false : 'Windows only');
}
