import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/Widgets/receipt_preview.dart';

void main() {
  testWidgets('ReceiptPaperPreview renders 58 mm layout with 32 columns and toggles to 80 mm', (tester) async {
    bool? changedWidth;

    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: SingleChildScrollView(
          child: Center(
            child: ReceiptPaperPreview(
              storeName: 'Toko Sumber Barokah',
              address: 'Jl. Merdeka No. 45',
              phone: '08123456789',
              footer: 'Terima kasih atas kunjungan Anda',
              initialIs80mm: false,
              onWidthChanged: (is80) => changedWidth = is80,
            ),
          ),
        ),
      ),
    ));

    await tester.pumpAndSettle();

    // 58 mm divider is exactly 32 dashes
    expect(find.text('-' * 32), findsWidgets);
    expect(find.text('TOKO SUMBER BAROKAH'), findsOneWidget);
    expect(find.textContaining('58 mm'), findsOneWidget);
    expect(find.textContaining('80 mm'), findsOneWidget);

    // Tap toggle pill to switch to 80 mm
    await tester.tap(find.textContaining('80 mm'));
    await tester.pumpAndSettle();

    expect(changedWidth, isTrue);

    // 80 mm divider is exactly 48 dashes
    expect(find.text('-' * 48), findsWidgets);
    expect(find.textContaining('QTY     HARGA      TOTAL'), findsOneWidget);
  });

  testWidgets('ReceiptPaperPreview initialIs80mm renders 80 mm with tabular column headers', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: SingleChildScrollView(
          child: Center(
            child: ReceiptPaperPreview(
              storeName: 'Supermarket Megah',
              initialIs80mm: true,
              saleId: 8899,
              cashier: 'Dewi',
              customer: 'Pelanggan VIP',
              items: const [
                {
                  'namaItem': 'Minyak Goreng 2L',
                  'qty': 2,
                  'satuan': 'Pcs',
                  'hargaJual': 34000,
                  'subtotal': 68000,
                },
                {
                  'namaItem': 'Beras Premium 5kg',
                  'qty': 1,
                  'satuan': 'Sak',
                  'hargaJual': 75000,
                  'subtotal': 75000,
                },
              ],
              total: 143000,
              paid: 150000,
              change: 7000,
            ),
          ),
        ),
      ),
    ));

    await tester.pumpAndSettle();

    expect(find.text('-' * 48), findsWidgets);
    expect(find.textContaining('QTY     HARGA      TOTAL'), findsOneWidget);
    expect(find.textContaining('Minyak Goreng 2L'), findsOneWidget);
    expect(find.textContaining('Beras Premium 5kg'), findsOneWidget);
    expect(find.textContaining('143.000'), findsWidgets);
  });

  testWidgets('showReceiptPreviewDialog displays modal preview with close button', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => showReceiptPreviewDialog(
              context,
              storeName: 'Toko Uji Coba',
              total: 50000,
            ),
            child: const Text('Buka Dialog Pratinjau'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('Buka Dialog Pratinjau'));
    await tester.pumpAndSettle();

    expect(find.text('Pratinjau Struk Toko'), findsOneWidget);
    expect(find.text('Tutup'), findsOneWidget);

    await tester.tap(find.text('Tutup'));
    await tester.pumpAndSettle();

    expect(find.text('Pratinjau Struk Toko'), findsNothing);
  });
}
