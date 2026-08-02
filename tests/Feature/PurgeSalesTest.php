<?php

use App\Models\Product;
use App\Models\Sale;
use App\Models\User;

function purgeAs(User $user)
{
    return test()->actingAs($user)
        ->withSession(['auth.password_confirmed_at' => time()]);
}

test('purging deletes sales before the given date, including unpaid bon', function () {
    $user = User::factory()->create();

    $old = Sale::factory()->create(['created_at' => now()->subDays(10)]);
    $oldBonBelumLunas = Sale::factory()->create([
        'created_at' => now()->subDays(10),
        'metode_pembayaran' => 'bon',
        'status' => 'selesai',
        'total' => 50000,
        'dibayar' => 0,
    ]);
    $recent = Sale::factory()->create(['created_at' => now()->subDay()]);

    $response = purgeAs($user)->delete(route('sales.purge'), [
        'before' => now()->subDays(5)->toDateString(),
    ]);

    $response->assertRedirect();
    expect(Sale::find($old->id))->toBeNull()
        ->and(Sale::find($oldBonBelumLunas->id))->toBeNull()
        ->and(Sale::find($recent->id))->not->toBeNull();
});

test('purging cascades to sale items', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();
    $sale = Sale::factory()->create(['created_at' => now()->subDays(10)]);

    $sale->items()->create([
        'product_id' => $product->id,
        'qty' => 1,
        'konversi' => 1,
        'satuan' => $product->satuan,
        'harga_jual' => 1000,
        'harga_pokok' => 800,
        'subtotal' => 1000,
    ]);

    purgeAs($user)->delete(route('sales.purge'), [
        'before' => now()->subDays(5)->toDateString(),
    ]);

    expect($sale->items()->count())->toBe(0);
});

test('purge rejects a date in the future', function () {
    $user = User::factory()->create();

    $response = purgeAs($user)->delete(route('sales.purge'), [
        'before' => now()->addDay()->toDateString(),
    ]);

    $response->assertSessionHasErrors('before');
});

test('purge accepts today as the cutoff, deleting everything except today', function () {
    $user = User::factory()->create();

    $yesterday = Sale::factory()->create(['created_at' => now()->subDay()]);
    $today = Sale::factory()->create(['created_at' => now()]);

    $response = purgeAs($user)->delete(route('sales.purge'), [
        'before' => now()->toDateString(),
    ]);

    $response->assertRedirect();
    expect(Sale::find($yesterday->id))->toBeNull()
        ->and(Sale::find($today->id))->not->toBeNull();
});

test('purge requires password confirmation', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->delete(route('sales.purge'), [
        'before' => now()->subDays(5)->toDateString(),
    ]);

    $response->assertRedirect(route('password.confirm'));
});
