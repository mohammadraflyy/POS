<?php

use App\Models\Category;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\Sale;
use App\Models\SaleItem;
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

test('updating a product returns to the page it was edited from', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();
    $previousUrl = route('inventory', ['page' => 2]);

    $this->actingAs($user)->get($previousUrl);

    $this->actingAs($user)->put(route('inventory.update', $product), [
        'kode_item' => $product->kode_item,
        'barcode' => $product->barcode,
        'nama_item' => 'Nama Baru',
        'kategori' => null,
        'satuan' => $product->satuan,
        'harga_pokok' => $product->harga_pokok,
        'harga_jual' => $product->harga_jual,
        'is_active' => true,
    ])->assertRedirect($previousUrl);

    expect($product->fresh()->nama_item)->toBe('Nama Baru');
});

test('updating a product resolves a new kategori by name', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();

    $this->actingAs($user)->put(route('inventory.update', $product), [
        'kode_item' => $product->kode_item,
        'barcode' => $product->barcode,
        'nama_item' => $product->nama_item,
        'kategori' => 'Minuman Dingin',
        'satuan' => $product->satuan,
        'harga_pokok' => $product->harga_pokok,
        'harga_jual' => $product->harga_jual,
        'is_active' => true,
    ])->assertRedirect();

    expect($product->fresh()->category->nama)->toBe('Minuman Dingin');
    expect(Category::where('nama', 'Minuman Dingin')->count())->toBe(1);
});

test('the quick search endpoint finds products by kode, nama, or barcode', function () {
    $user = User::factory()->create();
    Product::factory()->create(['kode_item' => '999', 'nama_item' => 'Kopi Susu Gula Aren', 'barcode' => 'ABC123']);
    Product::factory()->create(['nama_item' => 'Teh Botol']);

    $response = $this->actingAs($user)->getJson(route('inventory.search', ['q' => 'kopi susu']));

    $response->assertSuccessful();
    expect($response->json())->toHaveCount(1)
        ->and($response->json('0.nama_item'))->toBe('Kopi Susu Gula Aren');
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

test('a product with no history can be deleted', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();

    $this->actingAs($user)->delete(route('inventory.destroy', $product))
        ->assertRedirect();

    expect(Product::count())->toBe(0);
});

test('deleting a product returns to the page it was deleted from', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();
    $previousUrl = route('inventory', ['page' => 2]);

    $this->actingAs($user)->get($previousUrl);

    $this->actingAs($user)->delete(route('inventory.destroy', $product))
        ->assertRedirect($previousUrl);
});

test('multiple products can be deleted at once', function () {
    $user = User::factory()->create();
    $products = Product::factory()->count(3)->create();

    $this->actingAs($user)->delete(route('inventory.bulk-destroy'), [
        'ids' => $products->pluck('id')->all(),
    ])->assertRedirect();

    expect(Product::count())->toBe(0);
});

test('bulk delete reports which products could not be removed', function () {
    $user = User::factory()->create();
    $deletable = Product::factory()->create();
    $blocked = Product::factory()->create(['nama_item' => 'Produk Terjual']);
    $sale = Sale::factory()->create();
    SaleItem::create([
        'sale_id' => $sale->id,
        'product_id' => $blocked->id,
        'qty' => 1,
        'konversi' => 1,
        'satuan' => $blocked->satuan,
        'harga_jual' => $blocked->harga_jual,
        'harga_pokok' => $blocked->harga_pokok,
        'subtotal' => $blocked->harga_jual,
    ]);

    $response = $this->actingAs($user)->delete(route('inventory.bulk-destroy'), [
        'ids' => [$deletable->id, $blocked->id],
    ]);

    $response->assertSessionHasErrors('product');
    expect(Product::count())->toBe(1)
        ->and(Product::first()->id)->toBe($blocked->id);
});

test('a product with sale history cannot be deleted', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();
    $sale = Sale::factory()->create();
    SaleItem::create([
        'sale_id' => $sale->id,
        'product_id' => $product->id,
        'qty' => 1,
        'konversi' => 1,
        'satuan' => $product->satuan,
        'harga_jual' => $product->harga_jual,
        'harga_pokok' => $product->harga_pokok,
        'subtotal' => $product->harga_jual,
    ]);

    $response = $this->actingAs($user)->delete(route('inventory.destroy', $product));

    $response->assertSessionHasErrors('product');
    expect(Product::count())->toBe(1);
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
