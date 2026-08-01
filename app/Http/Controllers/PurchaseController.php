<?php

namespace App\Http\Controllers;

use App\Http\Requests\StorePurchaseRequest;
use App\Models\Product;
use App\Models\Purchase;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

class PurchaseController extends Controller
{
    public function store(StorePurchaseRequest $request): RedirectResponse
    {
        DB::transaction(function () use ($request) {
            $purchase = Purchase::create([
                'supplier_id' => $request->validated('supplier_id'),
                'user_id' => $request->user()->id,
                'tanggal' => $request->validated('tanggal'),
                'catatan' => $request->validated('catatan'),
            ]);

            $total = 0;

            foreach ($request->validated('items') as $item) {
                $subtotal = $item['qty'] * $item['harga_beli'];
                $total += $subtotal;

                $purchase->items()->create([
                    'product_id' => $item['product_id'],
                    'qty' => $item['qty'],
                    'harga_beli' => $item['harga_beli'],
                    'subtotal' => $subtotal,
                ]);

                Product::whereKey($item['product_id'])->increment('stok', $item['qty']);
            }

            $purchase->update(['total' => $total]);
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Stok masuk dicatat.')]);

        return to_route('inventory');
    }
}
