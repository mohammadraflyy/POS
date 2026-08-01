<?php

use App\Models\Product;
use App\Models\Sale;
use App\Models\User;

test('selling in a derived unit deducts stock by the conversion factor', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 100, 'satuan' => 'PCS', 'harga_jual' => 2000]);
    $dus = $product->productUnits()->create(['satuan' => 'DUS', 'konversi' => 12, 'harga_jual' => 20000]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 50000,
        'items' => [
            ['product_id' => $product->id, 'product_unit_id' => $dus->id, 'qty' => 2],
        ],
    ])->assertRedirect(route('kasir'));

    expect($product->fresh()->stok)->toBe(76);

    $sale = Sale::first();
    expect($sale->total)->toEqual(40000);

    $item = $sale->items->first();
    expect($item->satuan)->toBe('DUS')
        ->and($item->konversi)->toBe(12)
        ->and($item->qty)->toBe(2);
});

test('checkout fails when stock is insufficient for the derived unit', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 10, 'satuan' => 'PCS']);
    $dus = $product->productUnits()->create(['satuan' => 'DUS', 'konversi' => 12, 'harga_jual' => 20000]);

    $response = $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 50000,
        'items' => [
            ['product_id' => $product->id, 'product_unit_id' => $dus->id, 'qty' => 1],
        ],
    ]);

    $response->assertSessionHasErrors('items');
    expect($product->fresh()->stok)->toBe(10);
});

test('cancelling a sale with a derived unit restores stock using the conversion factor', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 100, 'satuan' => 'PCS']);
    $dus = $product->productUnits()->create(['satuan' => 'DUS', 'konversi' => 12, 'harga_jual' => 20000]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 50000,
        'items' => [
            ['product_id' => $product->id, 'product_unit_id' => $dus->id, 'qty' => 2],
        ],
    ]);

    expect($product->fresh()->stok)->toBe(76);

    $sale = Sale::first();
    $this->actingAs($user)->post(route('kasir.cancel', $sale))->assertRedirect(route('kasir'));

    expect($product->fresh()->stok)->toBe(100);
});
