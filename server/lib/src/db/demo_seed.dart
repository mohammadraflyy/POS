/// A believable small grocery shop for trying the apps out: products with packs and
/// tier prices, suppliers, customers, two months of purchases and a month of sales.
///
/// Everything goes through the same domain functions the API uses, so stock, average
/// cost, stock movements, supplier debt and bon receivables all add up exactly as they
/// would in a real shop.
library;

import 'dart:math';

import '../core/errors.dart';
import '../core/money.dart';
import '../domain/auth.dart';
import '../domain/expense.dart';
import '../domain/inventory.dart';
import '../domain/inventory_units.dart';
import '../domain/kasir.dart';
import '../domain/master_satuan.dart';
import '../domain/parties.dart';
import '../domain/purchase.dart';
import '../domain/settings.dart';
import '../domain/stock.dart';
import '../domain/users.dart';
import 'db.dart';

/// A product in the demo catalogue. Prices are rupiah.
class _DemoProduct {
  const _DemoProduct(this.kode, this.nama, this.kategori, this.satuan, this.pokok, this.jual, {this.barcode, this.kemasan, this.tier});

  final String kode;
  final String nama;
  final String kategori;
  final String satuan;
  final int pokok;
  final int jual;
  final String? barcode;

  /// A bigger pack sold alongside the base unit: (satuan, isi, harga jual rupiah).
  final (String, int, int)? kemasan;

  /// A cheaper price from a minimum qty of the base unit: (min qty, harga jual rupiah).
  final (int, int)? tier;
}

const _products = [
  _DemoProduct('BRS5', 'Beras Pandan Wangi 5kg', 'Sembako', 'SAK', 68000, 75000, barcode: '8991001000011', tier: (5, 73000)),
  _DemoProduct('BRSKG', 'Beras Curah', 'Sembako', 'KG', 12500, 14000),
  _DemoProduct('GULA1', 'Gula Pasir 1kg', 'Sembako', 'KG', 15500, 17500, barcode: '8991001000028'),
  _DemoProduct('MNYK2', 'Minyak Goreng 2L', 'Sembako', 'PCS', 31000, 35000, barcode: '8991001000035', kemasan: ('DUS', 6, 205000)),
  _DemoProduct('TLR10', 'Telur Ayam', 'Sembako', 'KG', 26000, 29000),
  _DemoProduct('TPG1', 'Tepung Terigu 1kg', 'Sembako', 'PCS', 11000, 13000, barcode: '8991001000042'),
  _DemoProduct('MIE1', 'Mie Instan Goreng', 'Makanan', 'PCS', 2700, 3500, barcode: '8991001000059', kemasan: ('DUS', 40, 120000), tier: (10, 3200)),
  _DemoProduct('MIE2', 'Mie Instan Kuah Ayam', 'Makanan', 'PCS', 2600, 3300, barcode: '8991001000066', kemasan: ('DUS', 40, 115000)),
  _DemoProduct('SRDN', 'Sarden Kaleng 155g', 'Makanan', 'PCS', 8500, 10500, barcode: '8991001000073'),
  _DemoProduct('KECAP', 'Kecap Manis 520ml', 'Bumbu', 'PCS', 19000, 22500, barcode: '8991001000080'),
  _DemoProduct('SAOS', 'Saus Sambal 340ml', 'Bumbu', 'PCS', 9500, 12000, barcode: '8991001000097'),
  _DemoProduct('GARAM', 'Garam Beryodium 250g', 'Bumbu', 'PCS', 2000, 3000, barcode: '8991001000103'),
  _DemoProduct('MSG', 'Penyedap Rasa 8g', 'Bumbu', 'PCS', 400, 500, kemasan: ('RENTENG', 12, 5500)),
  _DemoProduct('KOPI1', 'Kopi Sachet 25g', 'Minuman', 'PCS', 1300, 1500, barcode: '8991001000110', kemasan: ('RENTENG', 10, 14000)),
  _DemoProduct('TEH1', 'Teh Celup isi 25', 'Minuman', 'PCS', 5500, 7000, barcode: '8991001000127'),
  _DemoProduct('AQUA6', 'Air Mineral 600ml', 'Minuman', 'BTL', 2300, 3500, barcode: '8991001000134', kemasan: ('DUS', 24, 52000), tier: (12, 3000)),
  _DemoProduct('AQUAG', 'Air Galon Isi Ulang', 'Minuman', 'GALON', 4000, 6000),
  _DemoProduct('SUSU1', 'Susu Kental Manis 370g', 'Minuman', 'PCS', 10500, 12500, barcode: '8991001000141'),
  _DemoProduct('SODA', 'Minuman Soda 390ml', 'Minuman', 'BTL', 5000, 6500, barcode: '8991001000158'),
  _DemoProduct('KRPK', 'Keripik Singkong 100g', 'Snack', 'PCS', 6000, 8000, barcode: '8991001000165'),
  _DemoProduct('BSKT', 'Biskuit Kelapa 300g', 'Snack', 'PCS', 9000, 11500, barcode: '8991001000172'),
  _DemoProduct('WAFER', 'Wafer Coklat', 'Snack', 'PCS', 1600, 2000, kemasan: ('PAK', 10, 18500)),
  _DemoProduct('PRMN', 'Permen Mint', 'Snack', 'PCS', 400, 500, kemasan: ('BKS', 50, 22000)),
  _DemoProduct('RKK16', 'Rokok Kretek 16', 'Rokok', 'BKS', 27000, 30000, barcode: '8991001000189', kemasan: ('SLOP', 10, 290000)),
  _DemoProduct('RKF20', 'Rokok Filter 20', 'Rokok', 'BKS', 30500, 33000, barcode: '8991001000196', kemasan: ('SLOP', 10, 320000)),
  _DemoProduct('SABUN', 'Sabun Mandi Batang', 'Kebutuhan Rumah', 'PCS', 3500, 4500, barcode: '8991001000202'),
  _DemoProduct('SAMPO', 'Sampo Sachet', 'Kebutuhan Rumah', 'PCS', 800, 1000, kemasan: ('RENTENG', 12, 11000)),
  _DemoProduct('DTRJN', 'Deterjen Bubuk 800g', 'Kebutuhan Rumah', 'PCS', 19500, 23000, barcode: '8991001000219'),
  _DemoProduct('PSGG', 'Pasta Gigi 190g', 'Kebutuhan Rumah', 'PCS', 11000, 13500, barcode: '8991001000226'),
  _DemoProduct('TISU', 'Tisu Wajah 250 lembar', 'Kebutuhan Rumah', 'PCS', 12000, 15000, barcode: '8991001000233'),
  _DemoProduct('LPG3', 'Gas LPG 3kg (isi)', 'Kebutuhan Rumah', 'TABUNG', 19000, 22000),
  _DemoProduct('BTRAI', 'Baterai AA isi 2', 'Kebutuhan Rumah', 'PAK', 8000, 10000, barcode: '8991001000240'),
];

const _suppliers = [
  PartyInput(nama: 'CV Sumber Makmur', telepon: '0812-3456-7801', alamat: 'Jl. Pasar Baru No. 12', keterangan: 'Sembako & bumbu'),
  PartyInput(nama: 'PT Indo Distribusi', telepon: '021-555-0192', alamat: 'Kawasan Industri Blok C-7', keterangan: 'Mie, minuman, snack'),
  PartyInput(nama: 'UD Tirta Segar', telepon: '0813-2222-4410', alamat: 'Jl. Mawar No. 3', keterangan: 'Air mineral & galon'),
  PartyInput(nama: 'Agen Rokok Pak Darmo', telepon: '0857-1111-9090', alamat: 'Jl. Kenanga No. 21'),
  PartyInput(nama: 'Toko Grosir Sejahtera', telepon: '0821-7777-3030', alamat: 'Jl. Raya Timur KM 4', keterangan: 'Kebutuhan rumah tangga'),
];

/// Which supplier (index into [_suppliers]) delivers each category.
const _supplierFor = {
  'Sembako': 0,
  'Bumbu': 0,
  'Makanan': 1,
  'Minuman': 1,
  'Snack': 1,
  'Rokok': 3,
  'Kebutuhan Rumah': 4,
};

const _customers = [
  PartyInput(nama: 'Bu Siti', telepon: '0812-1000-2001', alamat: 'RT 02 / RW 05', keterangan: 'Langganan, sering bon'),
  PartyInput(nama: 'Pak Budi', telepon: '0813-1000-2002', alamat: 'Gg. Melati No. 4'),
  PartyInput(nama: 'Warung Bu Ani', telepon: '0814-1000-2003', alamat: 'Jl. Anggrek No. 9', keterangan: 'Beli grosir'),
  PartyInput(nama: 'Mas Joko', telepon: '0815-1000-2004'),
  PartyInput(nama: 'Bu Rina', telepon: '0816-1000-2005', alamat: 'Perum Griya Asri B-12'),
  PartyInput(nama: 'Pak Hasan', telepon: '0817-1000-2006', keterangan: 'Bayar tiap tanggal 1'),
  PartyInput(nama: 'Kantin SD Harapan', telepon: '0818-1000-2007', alamat: 'Jl. Pendidikan No. 1'),
  PartyInput(nama: 'Mbak Dewi', telepon: '0819-1000-2008'),
];

const _expenses = [
  ('Listrik', 450000, 'Token listrik toko'),
  ('Gaji', 1500000, 'Gaji karyawan mingguan'),
  ('Transport', 75000, 'Bensin ambil barang'),
  ('Air', 85000, 'Tagihan PDAM'),
  ('Lain-lain', 50000, 'Kantong plastik & lakban'),
  ('Kebersihan', 40000, 'Iuran sampah'),
];

/// How many of each table [seedDemoData] wrote.
typedef DemoCounts = Map<String, int>;

String _date(DateTime day) => '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

String _dateTime(DateTime day, int hour, int minute) => '${_date(day)}T${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}';

int _cents(int rupiah) => rupiah * 100;

/// Fills an empty shop database with demo data ending on [today] (default: now).
/// [seed] makes the run repeatable. Throws when the database already has products,
/// so it can never mix demo rows into a real shop.
DemoCounts seedDemoData(Db db, {int seed = 42, DateTime? today}) {
  if ((db.scalar<int>('SELECT count(*) FROM products') ?? 0) > 0) {
    throw BusinessException('Database sudah berisi produk. Data dummy hanya untuk database kosong.');
  }

  final random = Random(seed);
  final end = today ?? DateTime.now();
  final day0 = DateTime(end.year, end.month, end.day);

  return db.transaction(() {
    seedDefaultAdmin(db);

    final adminId = db.scalar<int>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")!;
    final kasirIds = [
      adminId,
      createUser(db, username: 'kasir1', name: 'Rina (Kasir)', password: 'kasir1', role: UserRole.kasir),
      createUser(db, username: 'kasir2', name: 'Andi (Kasir)', password: 'kasir2', role: UserRole.kasir),
    ];

    updateStoreSettings(
      db,
      namaToko: 'Toko Sembako Berkah (Demo)',
      alamat: 'Jl. Merdeka No. 45',
      telepon: '0812-0000-1234',
      pesanFooter: 'Terima kasih, selamat belanja kembali!',
      receiptWidth: '58mm',
      marginMinimalPersen: 10,
    );

    // --- catalogue -------------------------------------------------------------
    bulkSaveProducts(db, [
      for (final p in _products)
        BulkSaveRow(
          key: p.kode,
          id: null,
          kodeItem: p.kode,
          barcode: p.barcode,
          namaItem: p.nama,
          kategori: p.kategori,
          satuan: p.satuan,
          hargaPokok: _cents(p.pokok),
          hargaJual: _cents(p.jual),
          stok: 0,
        ),
    ], userId: adminId);

    final productIds = <String, int>{
      for (final row in db.select('SELECT id, kode_item FROM products')) row['kode_item'] as String: row['id'] as int,
    };
    final packUnitIds = <String, int>{};

    for (final p in _products) {
      final id = productIds[p.kode]!;

      if (p.kemasan case (final satuan, final isi, final jual)) {
        packUnitIds[p.kode] = addProductUnit(db, id, unitId: resolveOrCreateUnit(db, satuan), jumlahKemasan: isi, hargaJual: _cents(jual));
      }

      if (p.tier case (final minQty, final jual)) {
        addPriceTier(db, id, getBaseProductUnit(db, id).id, minQty: minQty, hargaJual: _cents(jual));
      }
    }

    final supplierIds = [for (final s in _suppliers) createSupplier(db, s)];

    for (final c in _customers) {
      createCustomer(db, c);
    }

    // --- purchases: a big opening stock, then a restock every week -------------
    var purchases = 0;

    void restock(DateTime day, double scale, {bool hutang = false}) {
      final byCategory = <int, List<PurchaseItemInput>>{};

      for (final p in _products) {
        final pack = packUnitIds[p.kode];
        final isi = p.kemasan?.$2 ?? 1;
        // buy a little dearer or cheaper than the list price so average cost moves
        final harga = (_cents(p.pokok) * isi * (0.97 + random.nextDouble() * 0.06)).round() ~/ 100 * 100;
        final qty = pack != null ? max(1, (scale * (2 + random.nextInt(3))).round()) : max(1, (scale * (20 + random.nextInt(30))).round());

        byCategory.putIfAbsent(_supplierFor[p.kategori]!, () => []).add(
              PurchaseItemInput(productId: productIds[p.kode]!, productUnitId: pack, qty: qty, hargaBeli: harga),
            );
      }

      for (final entry in byCategory.entries) {
        final total = entry.value.fold<int>(0, (sum, item) => sum + (item.qty * item.hargaBeli).round());

        recordPurchase(
          db,
          PurchaseInput(
            supplierId: supplierIds[entry.key],
            tanggal: _date(day),
            catatan: scale > 1.5 ? 'Stok awal' : 'Belanja mingguan',
            items: entry.value,
            userId: adminId,
            // the rokok agent and the grosir give credit: leave part of the invoice owing
            dibayar: hutang && (entry.key == 3 || entry.key == 4) ? (total * 0.4).round() ~/ 100 * 100 : null,
          ),
        );
        purchases++;
      }
    }

    restock(day0.subtract(const Duration(days: 60)), 3);

    for (var week = 4; week >= 0; week--) {
      restock(day0.subtract(Duration(days: week * 7 + 2)), 1, hutang: week <= 1);
    }

    // one lump payment against the rokok agent's open invoices
    final rokokDebt = listSupplierDebts(db, supplierIds[3]);

    if (rokokDebt.isNotEmpty) {
      recordSupplierPayment(db, supplierId: supplierIds[3], jumlah: _cents(200000), tanggal: _date(day0.subtract(const Duration(days: 1))), keterangan: 'Cicilan', userId: adminId);
    }

    // --- sales: 30 days of trading -------------------------------------------
    var sales = 0;
    final bonSaleIds = <int>[];
    final customerNames = [for (final c in _customers) c.nama];

    for (var back = 29; back >= 0; back--) {
      final day = day0.subtract(Duration(days: back));
      final count = 8 + random.nextInt(10) + (day.weekday >= DateTime.saturday ? 6 : 0);

      for (var n = 0; n < count; n++) {
        final lines = <CartItemInput>[];
        final picked = <String>{};

        for (var k = 0, size = 1 + random.nextInt(4); k < size; k++) {
          final p = _products[random.nextInt(_products.length)];

          if (!picked.add(p.kode)) {
            continue;
          }

          final usePack = packUnitIds.containsKey(p.kode) && random.nextDouble() < 0.15;
          final qty = usePack ? 1 : (p.satuan == 'KG' ? [0.5, 1, 1.5, 2][random.nextInt(4)] : 1 + random.nextInt(p.tier != null ? 12 : 3));

          lines.add(CartItemInput(productId: productIds[p.kode]!, productUnitId: usePack ? packUnitIds[p.kode] : null, qty: qty));
        }

        final roll = random.nextDouble();
        final metode = roll < 0.65
            ? MetodePembayaran.tunai
            : roll < 0.8
                ? MetodePembayaran.qris
                : roll < 0.88
                    ? MetodePembayaran.transfer
                    : MetodePembayaran.bon;
        final pelanggan = metode == MetodePembayaran.bon || random.nextDouble() < 0.2 ? customerNames[random.nextInt(customerNames.length)] : null;
        final subtotal = toCents(previewCart(db, lines)['subtotal'] as num);
        final diskon = subtotal > _cents(100000) && random.nextDouble() < 0.3 ? _cents(2000) : null;
        final total = subtotal - (diskon ?? 0);

        try {
          final result = checkout(
            db,
            CheckoutInput(
              metodePembayaran: metode,
              namaPelanggan: pelanggan,
              // cash customers round up to the next 5.000 or 10.000 note
              dibayar: switch (metode) {
                MetodePembayaran.tunai => ((total / _cents(5000)).ceil() + random.nextInt(2)) * _cents(5000),
                MetodePembayaran.bon => random.nextDouble() < 0.3 ? (total / 2).round() ~/ 10000 * 10000 : 0,
                _ => null,
              },
              userId: kasirIds[random.nextInt(kasirIds.length)],
              tanggal: _dateTime(day, 7 + random.nextInt(13), random.nextInt(60)),
              diskon: diskon,
              items: lines,
            ),
          );

          sales++;

          if (metode == MetodePembayaran.bon) {
            bonSaleIds.add(result.saleId);
          }
        } on BusinessException {
          // ran out of something - a real kasir would just tell the customer
        }
      }
    }

    // a handful of bons settled, some only partly
    var bonPayments = 0;

    for (final saleId in bonSaleIds.where((_) => random.nextDouble() < 0.4)) {
      final sale = db.first('SELECT total, dibayar FROM sales WHERE id = ?', [saleId])!;
      final sisa = (sale['total'] as int) - (sale['dibayar'] as int);

      if (sisa > 0) {
        recordBonPayment(db, saleId, random.nextBool() ? sisa : max(100, sisa ~/ 2 ~/ 100 * 100), 'Bayar bon');
        bonPayments++;
      }
    }

    // --- cash expenses and a stock opname --------------------------------------
    var expenses = 0;

    for (var back = 28; back >= 0; back -= 3) {
      final (kategori, jumlah, keterangan) = _expenses[random.nextInt(_expenses.length)];

      recordCashExpense(
        db,
        ExpenseInput(tanggal: _date(day0.subtract(Duration(days: back))), kategori: kategori, jumlah: _cents(jumlah), keterangan: keterangan),
        userId: adminId,
      );
      expenses++;
    }

    final telurId = productIds['TLR10']!;
    final stokTelur = db.scalar<num>('SELECT stok FROM products WHERE id = ?', [telurId])!;

    recordStockAdjustment(db, productId: telurId, stokSesudah: max(0, stokTelur - 1), alasan: 'Telur pecah', userId: adminId);

    return {
      'users': db.scalar<int>('SELECT count(*) FROM users')!,
      'products': _products.length,
      'product_units (kemasan)': packUnitIds.length,
      'suppliers': supplierIds.length,
      'customers': db.scalar<int>('SELECT count(*) FROM customers')!,
      'purchases': purchases,
      'sales': sales,
      'bon_payments': bonPayments,
      'cash_expenses': expenses,
    };
  });
}
