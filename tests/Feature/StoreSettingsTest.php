<?php

use App\Models\StoreSetting;
use App\Models\User;

test('store settings default to the app name the first time they are viewed', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->get(route('store-settings.edit'))->assertOk();

    expect(StoreSetting::query()->count())->toBe(1)
        ->and(StoreSetting::current()->nama_toko)->toBe(config('app.name'));
});

test('store settings can be updated', function () {
    $user = User::factory()->create();
    StoreSetting::current();

    $this->actingAs($user)->put(route('store-settings.update'), [
        'nama_toko' => 'Toko Rafly',
        'alamat' => 'Jl. Merdeka 1',
        'telepon' => '08123456789',
        'pesan_footer' => 'Terima kasih atas kunjungan Anda',
    ])->assertRedirect(route('store-settings.edit'));

    $setting = StoreSetting::current();
    expect($setting->nama_toko)->toBe('Toko Rafly')
        ->and($setting->alamat)->toBe('Jl. Merdeka 1')
        ->and($setting->telepon)->toBe('08123456789')
        ->and($setting->pesan_footer)->toBe('Terima kasih atas kunjungan Anda');
});

test('the store name is shared with every page and falls back to the app name', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertInertia(fn ($page) => $page->where('name', config('app.name')));
});
