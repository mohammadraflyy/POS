<?php

namespace App\Http\Controllers;

use App\Http\Requests\BulkDestroyProductRequest;
use App\Http\Requests\BulkSaveProductRequest;
use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class ProductController extends Controller
{
    /** @var array<int, int> */
    private const PER_PAGE_OPTIONS = [10, 25, 50, 100];

    public function index(Request $request): Response
    {
        $perPage = $request->integer('per_page', 25);

        if (! in_array($perPage, self::PER_PAGE_OPTIONS, true)) {
            $perPage = 25;
        }

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
            ->paginate($perPage)
            ->withQueryString();

        return Inertia::render('inventory', [
            'products' => $products,
            'filters' => $request->only('search', 'per_page'),
            'perPageOptions' => self::PER_PAGE_OPTIONS,
        ]);
    }

    /**
     * Live search for the command-palette quick search (`/` shortcut).
     */
    public function search(Request $request): JsonResponse
    {
        $q = $request->string('q')->toString();

        $products = Product::query()
            ->with('category:id,nama')
            ->when($q !== '', function ($query) use ($q) {
                $query->where(function ($query) use ($q) {
                    $query->where('kode_item', 'like', "%{$q}%")
                        ->orWhere('nama_item', 'like', "%{$q}%")
                        ->orWhere('barcode', 'like', "%{$q}%");
                });
            })
            ->orderBy('nama_item')
            ->limit(20)
            ->get(['id', 'kode_item', 'barcode', 'nama_item', 'category_id', 'satuan', 'harga_jual', 'is_active']);

        return response()->json($products);
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
        $categoryId = null;
        $kategori = $request->validated('kategori');

        if (! empty($kategori)) {
            $categoryId = Category::firstOrCreate(['nama' => $kategori])->id;
        }

        $product->update([
            ...$request->safe()->except('kategori'),
            'category_id' => $categoryId,
        ]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Produk diperbarui.')]);

        return back();
    }

    public function destroy(Product $product): RedirectResponse
    {
        try {
            $product->delete();
        } catch (QueryException) {
            return back()->withErrors([
                'product' => __('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.'),
            ]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Produk dihapus.')]);

        return back();
    }

    public function bulkDestroy(BulkDestroyProductRequest $request): RedirectResponse
    {
        $blocked = [];
        $deleted = 0;

        foreach (Product::whereIn('id', $request->validated('ids'))->get() as $product) {
            try {
                $product->delete();
                $deleted++;
            } catch (QueryException) {
                $blocked[] = $product->nama_item;
            }
        }

        if ($blocked !== []) {
            return back()->withErrors([
                'product' => __(':n produk tidak bisa dihapus karena sudah punya riwayat transaksi: :list.', [
                    'n' => count($blocked),
                    'list' => implode(', ', $blocked),
                ]),
            ]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __(':n produk dihapus.', ['n' => $deleted])]);

        return back();
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
