<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreStockAdjustmentRequest;
use App\Models\Product;
use App\Models\StockAdjustment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class StockAdjustmentController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('stock-opname');
    }

    /**
     * Find-by-fields product search for stock opname (kode, nama, kategori, barcode).
     */
    public function search(Request $request): JsonResponse
    {
        $q = $request->string('q')->toString();

        $products = Product::query()
            ->with('category:id,nama')
            ->where('is_active', true)
            ->when($q !== '', function ($query) use ($q) {
                $query->where(function ($query) use ($q) {
                    $query->where('kode_item', 'like', "%{$q}%")
                        ->orWhere('nama_item', 'like', "%{$q}%")
                        ->orWhere('barcode', 'like', "%{$q}%")
                        ->orWhereHas('category', fn ($query) => $query->where('nama', 'like', "%{$q}%"));
                });
            })
            ->orderBy('nama_item')
            ->limit(20)
            ->get(['id', 'kode_item', 'barcode', 'nama_item', 'category_id', 'satuan', 'stok']);

        return response()->json($products);
    }

    public function store(StoreStockAdjustmentRequest $request, Product $product): RedirectResponse
    {
        DB::transaction(function () use ($request, $product) {
            $stokSebelum = $product->stok;
            $stokSesudah = $request->validated('stok_sesudah');

            StockAdjustment::create([
                'product_id' => $product->id,
                'user_id' => $request->user()->id,
                'stok_sebelum' => $stokSebelum,
                'stok_sesudah' => $stokSesudah,
                'selisih' => $stokSesudah - $stokSebelum,
                'alasan' => $request->validated('alasan'),
                'tanggal' => today(),
            ]);

            $product->update(['stok' => $stokSesudah]);
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Stok opname dicatat.')]);

        return back();
    }
}
