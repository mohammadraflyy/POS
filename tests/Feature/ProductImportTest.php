<?php

use App\Models\Product;
use App\Models\ProductPriceHistory;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/**
 * Builds a spreadsheet shaped like a real-world export: a title block
 * above the actual table, a header row, and a blank spacer row between
 * data rows (mirroring the layout the import parser is designed for).
 */
function fakeCatalogUpload(array $dataRows): UploadedFile
{
    $spreadsheet = new Spreadsheet;
    $sheet = $spreadsheet->getActiveSheet();

    $sheet->fromArray([['DAFTAR ITEM']], null, 'E3');
    $sheet->fromArray([['TOKO SEMBAKO RATNA']], null, 'E6');

    $header = ['Kode Item', 'Kode Barcode', 'Nama Item', 'Jenis', 'Stok', 'Satuan', 'Harga Beli', 'Harga Jual'];
    $sheet->fromArray($header, null, 'B14');

    $row = 16;

    foreach ($dataRows as $dataRow) {
        $sheet->fromArray($dataRow, null, "B{$row}");
        $row += 2; // leave a blank spacer row, like the real export does
    }

    $path = tempnam(sys_get_temp_dir(), 'catalog').'.xlsx';
    (new Xlsx($spreadsheet))->save($path);

    return new UploadedFile(
        $path,
        'catalog.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        null,
        true,
    );
}

test('importing a catalog creates new products and updates changed ones, skipping unchanged rows', function () {
    $user = User::factory()->create();
    $unchanged = Product::factory()->create([
        'kode_item' => '001',
        'nama_item' => 'Kopi Sachet',
        'satuan' => 'PCS',
        'harga_pokok' => 1000,
        'harga_jual' => 1500,
    ]);
    $changed = Product::factory()->create([
        'kode_item' => '002',
        'nama_item' => 'Teh Celup',
        'satuan' => 'PCS',
        'harga_pokok' => 500,
        'harga_jual' => 800,
    ]);

    $file = fakeCatalogUpload([
        ['001', '8991000000001', 'Kopi Sachet', 'Kopi', 10, 'PCS', 1000, 1500],
        ['002', '8991000000002', 'Teh Celup', 'Teh', 10, 'PCS', 600, 900],
        ['003', '8991000000003', 'Gula Pasir 1kg', 'Sembako', 25, 'KG', 12000, 13000],
    ]);

    $response = $this->actingAs($user)->post(route('inventory.import'), ['file' => $file]);

    $response->assertRedirect(route('inventory'));

    expect($changed->fresh()->harga_pokok)->toEqual(600)
        ->and($changed->fresh()->harga_jual)->toEqual(900)
        ->and($unchanged->fresh()->harga_pokok)->toEqual(1000);

    $newProduct = Product::where('kode_item', '003')->first();
    expect($newProduct)->not->toBeNull()
        ->and($newProduct->nama_item)->toBe('Gula Pasir 1kg')
        ->and($newProduct->stok)->toBe(25)
        ->and($newProduct->category->nama)->toBe('Sembako');

    expect(ProductPriceHistory::where('product_id', $changed->id)->count())->toBe(1)
        ->and(ProductPriceHistory::where('product_id', $unchanged->id)->count())->toBe(0);
});

test('importing does not touch stock on existing products', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create([
        'kode_item' => '010',
        'nama_item' => 'Minyak Goreng',
        'satuan' => 'BTL',
        'stok' => 40,
    ]);

    $file = fakeCatalogUpload([
        ['010', '', 'Minyak Goreng', '', 999, 'BTL', 15000, 17000],
    ]);

    $this->actingAs($user)->post(route('inventory.import'), ['file' => $file]);

    expect($product->fresh()->stok)->toBe(40);
});
