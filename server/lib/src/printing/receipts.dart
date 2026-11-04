import '../core/money.dart';
import '../db/db.dart';
import '../domain/kasir.dart';
import '../domain/settings.dart';
import 'escpos.dart';
import 'printer.dart';

/// Builds one sale's struk from the database and sends it to the printer saved in
/// Pengaturan, or the OS default.
class ReceiptService {
  ReceiptService(this.db, this.printer);

  final Db db;
  final RawPrinter printer;

  ({StoreInfo store, PaperWidth paper, String? printerName}) _settings() {
    final settings = getStoreSettings(db);

    return (
      store: StoreInfo(
        namaToko: settings['namaToko'] as String,
        alamat: settings['alamat'] as String?,
        telepon: settings['telepon'] as String?,
        pesanFooter: settings['pesanFooter'] as String?,
      ),
      paper: PaperWidth.parse(settings['receiptWidth']),
      printerName: settings['printerName'] as String?,
    );
  }

  List<int> buildForSale(int saleId) {
    final receipt = getReceipt(db, saleId);
    final settings = _settings();

    return buildReceiptEscPos(
      ReceiptSale(
        saleId: receipt.saleId,
        diskon: toRupiah(receipt.diskon),
        total: toRupiah(receipt.total),
        dibayar: toRupiah(receipt.dibayar),
        biayaLain: toRupiah(receipt.biayaLain),
        metodePembayaran: receipt.metodePembayaran,
        namaPelanggan: receipt.namaPelanggan,
        createdAt: receipt.createdAt,
        kasirName: receipt.kasirName,
        keterangan: receipt.keterangan,
        items: [
          for (final item in receipt.items)
            ReceiptItem(
              namaItem: item.namaItem,
              qty: item.qty,
              satuan: item.satuan,
              hargaJual: toRupiah(item.hargaJual),
              diskon: toRupiah(item.diskon),
              subtotal: toRupiah(item.subtotal),
            ),
        ],
      ),
      settings.store,
      settings.paper,
    );
  }

  Future<void> printSale(int saleId) => printer.printRaw(_settings().printerName, buildForSale(saleId));

  Future<void> printTest() {
    final settings = _settings();

    return printer.printRaw(settings.printerName, buildReceiptEscPos(sampleReceipt(), settings.store, settings.paper));
  }
}
