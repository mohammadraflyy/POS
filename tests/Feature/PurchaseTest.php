<?php

use App\Models\Product;
use App\Models\Purchase;
use App\Models\Supplier;
use App\Models\User;

test('stock-in from a supplier increases product stock', function () {
    $user = User::factory()->create();
    $supplier = Supplier::factory()->create();
    $product = Product::factory()->create(['stok' => 5]);

    $response = $this->actingAs($user)->post(route('inventory.stock-in'), [
        'supplier_id' => $supplier->id,
        'tanggal' => today()->toDateString(),
        'items' => [
            ['product_id' => $product->id, 'qty' => 20, 'harga_beli' => 1000],
        ],
    ]);

    $response->assertRedirect(route('inventory'));
    expect($product->fresh()->stok)->toBe(25);

    $purchase = Purchase::first();
    expect($purchase->supplier_id)->toBe($supplier->id)
        ->and($purchase->total)->toEqual(20000);
});

test('stock-in without a supplier still increases stock', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 5]);

    $this->actingAs($user)->post(route('inventory.stock-in'), [
        'supplier_id' => null,
        'tanggal' => today()->toDateString(),
        'items' => [
            ['product_id' => $product->id, 'qty' => 10, 'harga_beli' => 1000],
        ],
    ])->assertRedirect(route('inventory'));

    expect($product->fresh()->stok)->toBe(15)
        ->and(Purchase::first()->supplier_id)->toBeNull();
});
