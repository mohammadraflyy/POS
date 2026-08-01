<?php

use App\Models\Category;
use App\Models\Product;
use App\Models\StockAdjustment;
use App\Models\User;

test('opname search finds products by kode, nama, barcode, or category', function () {
    $user = User::factory()->create();
    $kopi = Category::factory()->create(['nama' => 'Kopi']);
    $product = Product::factory()->create([
        'kode_item' => 'ABC123',
        'nama_item' => 'Kopi Sachet',
        'barcode' => '899000111',
        'category_id' => $kopi->id,
    ]);
    Product::factory()->create(['nama_item' => 'Produk Lain']);

    $byKode = $this->actingAs($user)->getJson(route('stock-opname.search', ['q' => 'ABC123']));
    $byBarcode = $this->actingAs($user)->getJson(route('stock-opname.search', ['q' => '899000111']));
    $byCategory = $this->actingAs($user)->getJson(route('stock-opname.search', ['q' => 'Kopi']));

    $byKode->assertJsonCount(1)->assertJsonFragment(['id' => $product->id]);
    $byBarcode->assertJsonCount(1)->assertJsonFragment(['id' => $product->id]);
    $byCategory->assertJsonCount(1)->assertJsonFragment(['id' => $product->id]);
});

test('recording an opname updates stock and logs the adjustment', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 50]);

    $this->actingAs($user)->post(route('stock-opname.store', $product), [
        'stok_sesudah' => 45,
        'alasan' => 'rusak',
    ])->assertRedirect();

    expect($product->fresh()->stok)->toBe(45);

    $adjustment = StockAdjustment::first();
    expect($adjustment->stok_sebelum)->toBe(50)
        ->and($adjustment->stok_sesudah)->toBe(45)
        ->and($adjustment->selisih)->toBe(-5)
        ->and($adjustment->alasan)->toBe('rusak');
});

test('an opname can increase stock as well', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stok' => 10]);

    $this->actingAs($user)->post(route('stock-opname.store', $product), [
        'stok_sesudah' => 15,
    ])->assertRedirect();

    expect($product->fresh()->stok)->toBe(15)
        ->and(StockAdjustment::first()->selisih)->toBe(5);
});
