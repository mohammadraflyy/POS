<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Http\Requests\Settings\StoreSettingUpdateRequest;
use App\Models\StoreSetting;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class StoreController extends Controller
{
    /**
     * Show the store settings page (name/address/phone/receipt footer).
     */
    public function edit(): Response
    {
        return Inertia::render('settings/store', [
            'storeSetting' => StoreSetting::current(),
        ]);
    }

    /**
     * Update the store settings.
     */
    public function update(StoreSettingUpdateRequest $request): RedirectResponse
    {
        StoreSetting::current()->update($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Pengaturan toko diperbarui.')]);

        return to_route('store-settings.edit');
    }
}
