<?php

use App\Models\Supplier;
use App\Models\User;

test('a supplier can be created inline', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->post(route('supplier.store'), [
        'nama' => 'Toko Sumber Makmur',
        'telepon' => '08123456789',
        'alamat' => 'Jl. Merdeka 1',
        'keterangan' => 'Langganan',
    ])->assertRedirect();

    expect(Supplier::where('nama', 'Toko Sumber Makmur')->exists())->toBeTrue();
});

test('updating a supplier returns to the page it was edited from', function () {
    $user = User::factory()->create();
    $supplier = Supplier::factory()->create();
    $previousUrl = route('supplier', ['page' => 2]);

    $this->actingAs($user)->get($previousUrl);

    $this->actingAs($user)->put(route('supplier.update', $supplier), [
        'nama' => 'Nama Baru',
        'telepon' => $supplier->telepon,
        'alamat' => $supplier->alamat,
        'keterangan' => $supplier->keterangan,
    ])->assertRedirect($previousUrl);

    expect($supplier->fresh()->nama)->toBe('Nama Baru');
});

test('deleting a supplier returns to the page it was deleted from', function () {
    $user = User::factory()->create();
    $supplier = Supplier::factory()->create();
    $previousUrl = route('supplier', ['page' => 2]);

    $this->actingAs($user)->get($previousUrl);

    $this->actingAs($user)->delete(route('supplier.destroy', $supplier))
        ->assertRedirect($previousUrl);

    expect(Supplier::count())->toBe(0);
});
