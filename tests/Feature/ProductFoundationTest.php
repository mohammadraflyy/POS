<?php

use App\Models\Category;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\User;

test('a category can be quick-added', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->post(route('categories.store'), ['nama' => 'Kopi'])
        ->assertRedirect();

    expect(Category::where('nama', 'Kopi')->exists())->toBeTrue();
});

test('duplicate category names are rejected', function () {
    $user = User::factory()->create();
    Category::factory()->create(['nama' => 'Kopi']);

    $response = $this->actingAs($user)->post(route('categories.store'), ['nama' => 'Kopi']);

    $response->assertSessionHasErrors('nama');
});

test('a product can be created with a category and barcode', function () {
    $user = User::factory()->create();
    $category = Category::factory()->create();

    $this->actingAs($user)->post(route('inventory.store'), [
        'kode_item' => '001',
        'barcode' => '8991234567890',
        'nama_item' => 'Kopi Sachet',
        'category_id' => $category->id,
        'satuan' => 'PCS',
        'harga_pokok' => 1000,
        'harga_jual' => 1500,
        'stok' => 0,
    ])->assertRedirect(route('inventory'));

    $product = Product::first();
    expect($product->barcode)->toBe('8991234567890')
        ->and($product->category_id)->toBe($category->id);
});

test('duplicate barcodes are rejected', function () {
    $user = User::factory()->create();
    Product::factory()->create(['barcode' => 'DUPLICATE']);
    $category = Category::factory()->create();

    $response = $this->actingAs($user)->post(route('inventory.store'), [
        'kode_item' => '002',
        'barcode' => 'DUPLICATE',
        'nama_item' => 'Produk Lain',
        'category_id' => $category->id,
        'satuan' => 'PCS',
        'harga_pokok' => 1000,
        'harga_jual' => 1500,
        'stok' => 0,
    ]);

    $response->assertSessionHasErrors('barcode');
});

test('a derived unit can be added and removed for a product', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['satuan' => 'PCS']);

    $this->actingAs($user)->post(route('inventory.units.store', $product), [
        'satuan' => 'DUS',
        'konversi' => 12,
        'harga_jual' => 15000,
    ])->assertRedirect();

    $unit = ProductUnit::first();
    expect($unit->product_id)->toBe($product->id)
        ->and($unit->konversi)->toBe(12);

    $this->actingAs($user)->delete(route('inventory.units.destroy', [$product, $unit]))
        ->assertRedirect();

    expect(ProductUnit::count())->toBe(0);
});

test('a product unit cannot be deleted through a different product', function () {
    $user = User::factory()->create();
    $productA = Product::factory()->create();
    $productB = Product::factory()->create();
    $unit = ProductUnit::create([
        'product_id' => $productA->id,
        'satuan' => 'DUS',
        'konversi' => 12,
        'harga_jual' => 15000,
    ]);

    $this->actingAs($user)->delete(route('inventory.units.destroy', [$productB, $unit]))
        ->assertNotFound();

    expect(ProductUnit::count())->toBe(1);
});
