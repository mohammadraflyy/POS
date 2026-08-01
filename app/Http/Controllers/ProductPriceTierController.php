<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreProductPriceTierRequest;
use App\Models\Product;
use App\Models\ProductPriceTier;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;

class ProductPriceTierController extends Controller
{
    public function store(StoreProductPriceTierRequest $request, Product $product): RedirectResponse
    {
        $product->priceTiers()->create($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Harga bertingkat ditambahkan.')]);

        return back();
    }

    public function destroy(Product $product, ProductPriceTier $priceTier): RedirectResponse
    {
        abort_unless($priceTier->product_id === $product->id, 404);

        $priceTier->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Harga bertingkat dihapus.')]);

        return back();
    }
}
