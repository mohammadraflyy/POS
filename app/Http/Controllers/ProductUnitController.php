<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreProductUnitRequest;
use App\Models\Product;
use App\Models\ProductUnit;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;

class ProductUnitController extends Controller
{
    public function store(StoreProductUnitRequest $request, Product $product): RedirectResponse
    {
        $product->productUnits()->create($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Satuan ditambahkan.')]);

        return back();
    }

    public function destroy(Product $product, ProductUnit $productUnit): RedirectResponse
    {
        abort_unless($productUnit->product_id === $product->id, 404);

        $productUnit->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Satuan dihapus.')]);

        return back();
    }
}
