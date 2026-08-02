<?php

namespace App\Http\Controllers;

use App\Http\Requests\StorePurchaseRequest;
use App\Models\Category;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Supplier;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class PurchaseController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('purchase', [
            'suppliers' => Supplier::query()->orderBy('nama')->get(['id', 'nama']),
            'categories' => Category::query()->orderBy('nama')->get(['id', 'nama']),
            'purchases' => Purchase::query()
                ->with(['supplier:id,nama', 'items.product:id,nama_item'])
                ->latest('tanggal')
                ->latest('id')
                ->limit(20)
                ->get(),
        ]);
    }

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

        return to_route('purchase');
    }
}
