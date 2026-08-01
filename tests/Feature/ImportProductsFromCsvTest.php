<?php

use App\Models\Product;

test('it imports products from a csv file', function () {
    $path = tempnam(sys_get_temp_dir(), 'products').'.csv';
    file_put_contents($path, <<<'CSV'
        kode_item,nama_item,kategori,satuan,harga_pokok,harga_jual
        001,KAPAL API 6G,KOPI,RNTNG,8975,9500
        002,GOOD DAY FREEZE,KOPI,RNTNG,22050,22500
        CSV);

    $this->artisan('app:import-products-from-csv', ['path' => $path])
        ->expectsOutputToContain('Imported 2 products.')
        ->assertExitCode(0);

    expect(Product::count())->toBe(2);

    $product = Product::where('kode_item', '001')->first();
    expect($product->nama_item)->toBe('KAPAL API 6G')
        ->and($product->stok)->toBe(0)
        ->and($product->is_active)->toBeTrue();

    unlink($path);
});

test('re-importing updates existing products instead of duplicating', function () {
    $path = tempnam(sys_get_temp_dir(), 'products').'.csv';
    file_put_contents($path, <<<'CSV'
        kode_item,nama_item,kategori,satuan,harga_pokok,harga_jual
        001,KAPAL API 6G,KOPI,RNTNG,8975,9500
        CSV);

    $this->artisan('app:import-products-from-csv', ['path' => $path])->assertExitCode(0);

    file_put_contents($path, <<<'CSV'
        kode_item,nama_item,kategori,satuan,harga_pokok,harga_jual
        001,KAPAL API 6G BARU,KOPI,RNTNG,9000,9600
        CSV);

    $this->artisan('app:import-products-from-csv', ['path' => $path])->assertExitCode(0);

    expect(Product::count())->toBe(1);
    expect(Product::first()->nama_item)->toBe('KAPAL API 6G BARU');

    unlink($path);
});

test('it fails gracefully when the file does not exist', function () {
    $this->artisan('app:import-products-from-csv', ['path' => 'nonexistent.csv'])
        ->assertExitCode(1);
});
