<?php

namespace App\Http\Controllers;

use App\Http\Requests\BulkSaveProductRequest;
use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class ProductController extends Controller
{
    public function index(Request $request): Response
    {
        $products = Product::query()
            ->with(['category:id,nama', 'productUnits', 'priceTiers'])
            ->when($request->string('search')->toString(), function ($query, $search) {
                $query->where(function ($query) use ($search) {
                    $query->where('kode_item', 'like', "%{$search}%")
                        ->orWhere('nama_item', 'like', "%{$search}%")
                        ->orWhere('barcode', 'like', "%{$search}%");
                });
            })
            ->orderBy('nama_item')
            ->paginate(20)
            ->withQueryString();

        return Inertia::render('inventory', [
            'products' => $products,
            'filters' => $request->only('search'),
            'categories' => Category::query()->orderBy('nama')->get(['id', 'nama']),
        ]);
    }

    /**
     * Mass input page: blank grid ("Mass Add"), or pre-loaded with the
     * given product ids for editing ("Mass Edit", `?ids=1,2,3`).
     */
    public function massInput(Request $request): Response
    {
        $ids = collect(explode(',', (string) $request->string('ids')))
            ->filter()
            ->map(fn (string $id): int => (int) $id)
            ->all();

        return Inertia::render('inventory/mass-input', [
            'initialProducts' => $ids === []
                ? []
                : Product::query()
                    ->whereIn('id', $ids)
                    ->with(['category:id,nama', 'productUnits', 'priceTiers'])
                    ->orderBy('nama_item')
                    ->get(),
        ]);
    }

    public function store(StoreProductRequest $request): RedirectResponse
    {
        Product::create([...$request->validated(), 'is_active' => true]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Produk ditambahkan.')]);

        return to_route('inventory');
    }

    public function update(UpdateProductRequest $request, Product $product): RedirectResponse
    {
        $product->update($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Produk diperbarui.')]);

        return to_route('inventory');
    }

    /**
     * Mass-save products from the Excel-like grid: each row without an `id`
     * is created, each row with an `id` is updated. All-or-nothing.
     */
    public function bulkSave(BulkSaveProductRequest $request): RedirectResponse
    {
        $rows = $request->validated('rows');

        DB::transaction(function () use ($rows) {
            foreach ($rows as $row) {
                $categoryId = null;

                if (! empty($row['kategori'])) {
                    $categoryId = Category::firstOrCreate(['nama' => $row['kategori']])->id;
                }

                $attributes = [
                    'kode_item' => $row['kode_item'],
                    'barcode' => $row['barcode'] ?? null,
                    'nama_item' => $row['nama_item'],
                    'category_id' => $categoryId,
                    'satuan' => $row['satuan'],
                    'harga_pokok' => $row['harga_pokok'],
                    'harga_jual' => $row['harga_jual'],
                ];

                if (! empty($row['id'])) {
                    // Stock changes flow through Purchase/StockAdjustment for
                    // an audit trail, so bulk-edit never touches `stok`.
                    Product::whereKey($row['id'])->update($attributes);
                } else {
                    Product::create([
                        ...$attributes,
                        'stok' => $row['stok'] ?? 0,
                        'is_active' => true,
                    ]);
                }
            }
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __(':n produk disimpan.', ['n' => count($rows)])]);

        return to_route('inventory');
    }
}
