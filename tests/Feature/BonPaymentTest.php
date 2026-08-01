<?php

use App\Models\Product;
use App\Models\Sale;
use App\Models\User;

test('bon payment reduces sisa piutang', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 10, 'harga_jual' => 5000]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'bon',
        'nama_pelanggan' => 'Budi',
        'items' => [
            ['product_id' => $product->id, 'qty' => 4],
        ],
    ]);

    $sale = Sale::first();
    expect($sale->sisaPiutang())->toEqual(20000);

    $this->actingAs($user)->post(route('kasir.bon-payments.store', $sale), ['jumlah' => 8000])
        ->assertRedirect();

    expect($sale->fresh()->sisaPiutang())->toEqual(12000);
});

test('bon payment cannot exceed sisa piutang', function () {
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

    $response = $this->actingAs($user)->post(route('kasir.bon-payments.store', $sale), ['jumlah' => 999999]);

    $response->assertSessionHasErrors('jumlah');
    expect($sale->fresh()->sisaPiutang())->toEqual(10000);
});
