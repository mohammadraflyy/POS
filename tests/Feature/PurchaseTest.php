<?php

use App\Models\Product;
use App\Models\Purchase;
use App\Models\Supplier;
use App\Models\User;

test('stock-in from a supplier increases product stock', function () {
    $user = User::factory()->create();
    $supplier = Supplier::factory()->create();
    $product = Product::factory()->create(['stok' => 5]);

    $response = $this->actingAs($user)->post(route('purchase.store'), [
        'supplier_id' => $supplier->id,
        'tanggal' => today()->toDateString(),
        'items' => [
            ['product_id' => $product->id, 'qty' => 20, 'harga_beli' => 1000],
        ],
    ]);

    $response->assertRedirect(route('purchase'));
    expect($product->fresh()->stok)->toBe(25);

    $purchase = Purchase::first();
    expect($purchase->supplier_id)->toBe($supplier->id)
        ->and($purchase->total)->toEqual(20000);
});

test('stock-in without a supplier still increases stock', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 5]);

    $this->actingAs($user)->post(route('purchase.store'), [
        'supplier_id' => null,
        'tanggal' => today()->toDateString(),
        'items' => [
            ['product_id' => $product->id, 'qty' => 10, 'harga_beli' => 1000],
        ],
    ])->assertRedirect(route('purchase'));

    expect($product->fresh()->stok)->toBe(15)
        ->and(Purchase::first()->supplier_id)->toBeNull();
});

test('the purchase page lists suppliers, categories, and recent purchases', function () {
    $user = User::factory()->create();
    $supplier = Supplier::factory()->create();
    $product = Product::factory()->create();

    $this->actingAs($user)->post(route('purchase.store'), [
        'supplier_id' => $supplier->id,
        'tanggal' => today()->toDateString(),
        'items' => [
            ['product_id' => $product->id, 'qty' => 5, 'harga_beli' => 2000],
        ],
    ]);

    $response = $this->actingAs($user)->get(route('purchase'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('purchase')
        ->has('suppliers', 1)
        ->has('purchases', 1)
        ->where('purchases.0.supplier.nama', $supplier->nama)
        ->where('purchases.0.items.0.product.nama_item', $product->nama_item)
    );
});

test('creating a product from an XHR request returns JSON instead of redirecting', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)
        ->postJson(route('inventory.store'), [
            'kode_item' => 'NEW-001',
            'barcode' => null,
            'nama_item' => 'Produk Baru',
            'category_id' => null,
            'satuan' => 'PCS',
            'harga_pokok' => 1000,
            'harga_jual' => 1500,
            'stok' => 0,
        ]);

    $response->assertOk();
    $response->assertJsonFragment(['nama_item' => 'Produk Baru']);
    expect(Product::where('kode_item', 'NEW-001')->exists())->toBeTrue();
});

test('creating a supplier from an XHR request returns JSON instead of redirecting', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)
        ->postJson(route('supplier.store'), [
            'nama' => 'Supplier Baru',
        ]);

    $response->assertOk();
    $response->assertJsonFragment(['nama' => 'Supplier Baru']);
    expect(Supplier::where('nama', 'Supplier Baru')->exists())->toBeTrue();
});
