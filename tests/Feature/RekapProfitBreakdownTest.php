<?php

use App\Models\Category;
use App\Models\Product;
use App\Models\User;

test('rekap breaks down profit by category and by day', function () {
    $user = User::factory()->create();
    $kopi = Category::factory()->create(['nama' => 'Kopi']);
    $product = Product::factory()->create([
        'category_id' => $kopi->id,
        'harga_pokok' => 1000,
        'harga_jual' => 1500,
        'stok' => 10,
    ]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 5000,
        'items' => [
            ['product_id' => $product->id, 'qty' => 2],
        ],
    ]);

    $response = $this->actingAs($user)->get(route('rekap'));

    $response->assertInertia(fn ($page) => $page
        ->where('labaPerKategori.0.nama', 'Kopi')
        ->where('labaPerKategori.0.laba', 1000)
        ->has('labaPerHari', 1)
        ->where('labaPerHari.0.laba', 1000)
    );
});

test('a derived-unit sale is accounted for correctly in the profit breakdown', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create([
        'harga_pokok' => 1000,
        'harga_jual' => 1500,
        'stok' => 100,
        'satuan' => 'PCS',
    ]);
    $dus = $product->productUnits()->create(['satuan' => 'DUS', 'konversi' => 10, 'harga_jual' => 14000]);

    $this->actingAs($user)->post(route('kasir.store'), [
        'metode_pembayaran' => 'tunai',
        'dibayar' => 50000,
        'items' => [
            ['product_id' => $product->id, 'product_unit_id' => $dus->id, 'qty' => 1],
        ],
    ]);

    $response = $this->actingAs($user)->get(route('rekap'));

    // omzet 14000, cost = 10 pcs * 1000 = 10000, laba = 4000
    $response->assertInertia(fn ($page) => $page
        ->where('summary.laba_kotor', 4000)
    );
});
