<?php

use App\Models\Category;
use App\Models\Product;
use App\Models\User;

test('bulk save creates products and auto-creates missing categories', function () {
    $user = User::factory()->create();

    $rows = [
        ['kode_item' => '9001', 'nama_item' => 'Kopi Sachet Baru', 'kategori' => 'Kopi', 'satuan' => 'PCS', 'harga_pokok' => 1500, 'harga_jual' => 2000, 'stok' => 50],
        ['kode_item' => '9002', 'nama_item' => 'Mie Instan Baru', 'kategori' => 'Indomie', 'satuan' => 'PCS', 'harga_pokok' => 2500, 'harga_jual' => 3000],
    ];

    $this->actingAs($user)->post(route('inventory.bulk-save'), ['rows' => $rows])
        ->assertRedirect(route('inventory'));

    expect(Product::count())->toBe(2);

    $first = Product::where('kode_item', '9001')->first();
    expect($first->nama_item)->toBe('Kopi Sachet Baru')
        ->and($first->stok)->toBe(50)
        ->and($first->category->nama)->toBe('Kopi');

    $second = Product::where('kode_item', '9002')->first();
    expect($second->stok)->toBe(0);

    expect(Category::where('nama', 'Indomie')->exists())->toBeTrue();
});

test('bulk save updates existing products by id and never touches stok', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['kode_item' => '9001', 'nama_item' => 'Nama Lama', 'harga_jual' => 1000, 'stok' => 25]);

    $rows = [
        ['id' => $product->id, 'kode_item' => '9001', 'nama_item' => 'Nama Baru', 'satuan' => $product->satuan, 'harga_pokok' => $product->harga_pokok, 'harga_jual' => 1200, 'stok' => 999],
    ];

    $this->actingAs($user)->post(route('inventory.bulk-save'), ['rows' => $rows])
        ->assertRedirect(route('inventory'));

    $product->refresh();
    expect($product->nama_item)->toBe('Nama Baru')
        ->and((float) $product->harga_jual)->toBe(1200.0)
        ->and($product->stok)->toBe(25);
});

test('bulk save handles create and update in the same request', function () {
    $user = User::factory()->create();
    $existing = Product::factory()->create(['kode_item' => 'EXIST', 'nama_item' => 'Lama']);

    $rows = [
        ['id' => $existing->id, 'kode_item' => 'EXIST', 'nama_item' => 'Diperbarui', 'satuan' => $existing->satuan, 'harga_pokok' => $existing->harga_pokok, 'harga_jual' => $existing->harga_jual],
        ['kode_item' => 'NEWROW', 'nama_item' => 'Produk Baru', 'satuan' => 'PCS', 'harga_pokok' => 1000, 'harga_jual' => 1500, 'stok' => 5],
    ];

    $this->actingAs($user)->post(route('inventory.bulk-save'), ['rows' => $rows])
        ->assertRedirect(route('inventory'));

    expect(Product::count())->toBe(2);
    expect($existing->refresh()->nama_item)->toBe('Diperbarui');
    expect(Product::where('kode_item', 'NEWROW')->exists())->toBeTrue();
});

test('bulk save rejects a kode_item duplicated within the same request', function () {
    $user = User::factory()->create();

    $rows = [
        ['kode_item' => '9001', 'nama_item' => 'Produk A', 'satuan' => 'PCS', 'harga_pokok' => 1000, 'harga_jual' => 1500, 'stok' => 1],
        ['kode_item' => '9001', 'nama_item' => 'Produk B', 'satuan' => 'PCS', 'harga_pokok' => 1000, 'harga_jual' => 1500, 'stok' => 1],
    ];

    $response = $this->actingAs($user)->post(route('inventory.bulk-save'), ['rows' => $rows]);

    $response->assertSessionHasErrors('rows.1.kode_item');
    expect(Product::count())->toBe(0);
});

test('bulk save rejects a kode_item that already exists in the database', function () {
    $user = User::factory()->create();
    Product::factory()->create(['kode_item' => '9001']);

    $rows = [
        ['kode_item' => '9001', 'nama_item' => 'Duplikat', 'satuan' => 'PCS', 'harga_pokok' => 1000, 'harga_jual' => 1500, 'stok' => 1],
    ];

    $response = $this->actingAs($user)->post(route('inventory.bulk-save'), ['rows' => $rows]);

    $response->assertSessionHasErrors('rows.0.kode_item');
    expect(Product::count())->toBe(1);
});

test('bulk save is all-or-nothing when one row is invalid', function () {
    $user = User::factory()->create();

    $rows = [
        ['kode_item' => '9001', 'nama_item' => 'Produk Valid', 'satuan' => 'PCS', 'harga_pokok' => 1000, 'harga_jual' => 1500, 'stok' => 1],
        ['kode_item' => '', 'nama_item' => 'Produk Tidak Valid', 'satuan' => 'PCS', 'harga_pokok' => 1000, 'harga_jual' => 1500],
    ];

    $response = $this->actingAs($user)->post(route('inventory.bulk-save'), ['rows' => $rows]);

    $response->assertSessionHasErrors('rows.1.kode_item');
    expect(Product::count())->toBe(0);
});
