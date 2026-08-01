<?php

use App\Models\Product;
use App\Models\Sale;
use App\Models\User;

test('buying below the tier threshold uses the base price', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 20, 'harga_jual' => 2000]);
    $product->priceTiers()->create(['min_qty' => 6, 'harga_jual' => 1800]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 20000,
        'items' => [
            ['product_id' => $product->id, 'qty' => 3],
        ],
    ])->assertRedirect(route('kasir'));

    expect(Sale::first()->total)->toEqual(6000);
});

test('buying at or above the tier threshold uses the tier price', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 20, 'harga_jual' => 2000]);
    $product->priceTiers()->create(['min_qty' => 6, 'harga_jual' => 1800]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 20000,
        'items' => [
            ['product_id' => $product->id, 'qty' => 6],
        ],
    ])->assertRedirect(route('kasir'));

    expect(Sale::first()->total)->toEqual(10800);
});

test('the highest satisfied tier wins when multiple tiers exist', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 50, 'harga_jual' => 2000]);
    $product->priceTiers()->create(['min_qty' => 6, 'harga_jual' => 1800]);
    $product->priceTiers()->create(['min_qty' => 12, 'harga_jual' => 1500]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 50000,
        'items' => [
            ['product_id' => $product->id, 'qty' => 12],
        ],
    ])->assertRedirect(route('kasir'));

    expect(Sale::first()->total)->toEqual(18000);
});
