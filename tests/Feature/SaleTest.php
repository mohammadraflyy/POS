<?php

use App\Models\Product;
use App\Models\Sale;
use App\Models\User;

test('checkout tunai decrements stock and records sale', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 10, 'harga_jual' => 5000]);

    $response = $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 20000,
        'items' => [
            ['product_id' => $product->id, 'qty' => 3],
        ],
    ]);

    $response->assertRedirect(route('kasir'));
    expect($product->fresh()->stok)->toBe(7);

    $sale = Sale::first();
    expect($sale->total)->toEqual(15000)
        ->and($sale->status)->toBe('selesai')
        ->and($sale->metode_pembayaran)->toBe('tunai');
});

test('checkout bon does not require payment and tracks piutang', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 10, 'harga_jual' => 5000]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'bon',
        'nama_pelanggan' => 'Budi',
        'items' => [
            ['product_id' => $product->id, 'qty' => 2],
        ],
    ])->assertRedirect(route('kasir'));

    $sale = Sale::first();
    expect($sale->dibayar)->toEqual(0)
        ->and($sale->sisaPiutang())->toEqual(10000);
});

test('checkout fails when stock is insufficient', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 1]);

    $response = $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 100000,
        'items' => [
            ['product_id' => $product->id, 'qty' => 5],
        ],
    ]);

    $response->assertSessionHasErrors('items');
    expect($product->fresh()->stok)->toBe(1);
});

test('cancelling a sale restores stock', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 10, 'harga_jual' => 5000]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 20000,
        'items' => [
            ['product_id' => $product->id, 'qty' => 4],
        ],
    ]);

    $sale = Sale::first();
    expect($product->fresh()->stok)->toBe(6);

    $this->actingAs($user)->post(route('kasir.cancel', $sale))
        ->assertRedirect(route('kasir'));

    expect($product->fresh()->stok)->toBe(10)
        ->and($sale->fresh()->status)->toBe('dibatalkan');
});

test('a sale cannot be cancelled once a bon payment has been made', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 10, 'harga_jual' => 5000]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'bon',
        'nama_pelanggan' => 'Budi',
        'items' => [
            ['product_id' => $product->id, 'qty' => 2],
        ],
    ]);

    $sale = Sale::first();
    $this->actingAs($user)->post(route('kasir.bon-payments.store', $sale), ['jumlah' => 5000]);

    $response = $this->actingAs($user)->post(route('kasir.cancel', $sale));

    $response->assertSessionHasErrors('sale');
    expect($sale->fresh()->status)->toBe('selesai')
        ->and($product->fresh()->stok)->toBe(8);
});
