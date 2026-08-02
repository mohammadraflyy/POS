<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSaleRequest;
use App\Models\Product;
use App\Models\Sale;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class SaleController extends Controller
{
    public function index(): Response
    {
        $products = Product::query()
            ->where('is_active', true)
            ->with('productUnits', 'priceTiers')
            ->orderBy('nama_item')
            ->get(['id', 'kode_item', 'barcode', 'nama_item', 'satuan', 'harga_jual', 'stok']);

        $sales = Sale::query()
            ->with(['items.product:id,nama_item', 'user:id,name'])
            ->whereDate('created_at', today())
            ->latest()
            ->get();

        return Inertia::render('kasir', [
            'products' => $products,
            'sales' => $sales,
        ]);
    }

    public function history(Request $request): Response
    {
        $sales = Sale::query()
            ->with(['items.product:id,nama_item', 'user:id,name'])
            ->when($request->date('dari'), fn ($query, $dari) => $query->whereDate('created_at', '>=', $dari))
            ->when($request->date('sampai'), fn ($query, $sampai) => $query->whereDate('created_at', '<=', $sampai))
            ->when($request->string('status')->toString(), fn ($query, $status) => $query->where('status', $status))
            ->when($request->string('metode_pembayaran')->toString(), fn ($query, $metode) => $query->where('metode_pembayaran', $metode))
            ->when($request->string('search')->toString(), function ($query, $search) {
                $query->where(function ($query) use ($search) {
                    $query->where('nama_pelanggan', 'like', "%{$search}%")
                        ->orWhereHas('items.product', fn ($query) => $query->where('nama_item', 'like', "%{$search}%"));
                });
            })
            ->latest()
            ->paginate(20)
            ->withQueryString();

        return Inertia::render('kasir-history', [
            'sales' => $sales,
            'filters' => $request->only('dari', 'sampai', 'status', 'metode_pembayaran', 'search'),
        ]);
    }

    public function store(StoreSaleRequest $request): RedirectResponse
    {
        $items = $request->validated('items');
        $products = Product::whereKey(array_column($items, 'product_id'))
            ->with('productUnits', 'priceTiers')
            ->get()
            ->keyBy('id');

        $resolved = [];

        foreach ($items as $item) {
            $product = $products->get($item['product_id']);

            if (! $product) {
                throw ValidationException::withMessages([
                    'items' => __('Produk tidak ditemukan.'),
                ]);
            }

            if ($item['product_unit_id'] ?? null) {
                $unit = $product->productUnits->firstWhere('id', $item['product_unit_id']);

                if (! $unit) {
                    throw ValidationException::withMessages([
                        'items' => __('Satuan tidak valid untuk :nama.', ['nama' => $product->nama_item]),
                    ]);
                }

                $satuan = $unit->satuan;
                $konversi = $unit->konversi;
                $hargaJual = $unit->harga_jual;
                $productUnitId = $unit->id;
            } else {
                $satuan = $product->satuan;
                $konversi = 1;
                $hargaJual = $product->priceForQty($item['qty']);
                $productUnitId = null;
            }

            $qtyDasar = $item['qty'] * $konversi;

            if ($product->stok < $qtyDasar) {
                throw ValidationException::withMessages([
                    'items' => __('Stok :nama tidak cukup.', ['nama' => $product->nama_item]),
                ]);
            }

            $resolved[] = [
                'product' => $product,
                'qty' => $item['qty'],
                'qty_dasar' => $qtyDasar,
                'product_unit_id' => $productUnitId,
                'satuan' => $satuan,
                'konversi' => $konversi,
                'harga_jual' => $hargaJual,
            ];
        }

        DB::transaction(function () use ($request, $resolved) {
            $metodePembayaran = $request->validated('metode_pembayaran');

            $sale = Sale::create([
                'user_id' => $request->user()->id,
                'nama_pelanggan' => $request->validated('nama_pelanggan'),
                'metode_pembayaran' => $metodePembayaran,
                'status' => 'selesai',
                'dibayar' => $metodePembayaran === 'tunai' ? $request->validated('dibayar') : 0,
            ]);

            $total = 0;

            foreach ($resolved as $line) {
                $subtotal = $line['qty'] * $line['harga_jual'];
                $total += $subtotal;

                $sale->items()->create([
                    'product_id' => $line['product']->id,
                    'product_unit_id' => $line['product_unit_id'],
                    'qty' => $line['qty'],
                    'konversi' => $line['konversi'],
                    'satuan' => $line['satuan'],
                    'harga_jual' => $line['harga_jual'],
                    'harga_pokok' => $line['product']->harga_pokok,
                    'subtotal' => $subtotal,
                ]);

                $line['product']->decrement('stok', $line['qty_dasar']);
            }

            $sale->update(['total' => $total]);

            if ($metodePembayaran === 'tunai' && $sale->dibayar < $total) {
                throw ValidationException::withMessages([
                    'dibayar' => __('Uang bayar kurang dari total belanja.'),
                ]);
            }
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Transaksi disimpan.')]);

        return to_route('kasir');
    }

    public function cancel(Sale $sale): RedirectResponse
    {
        if ($sale->status === 'dibatalkan') {
            return back()->withErrors(['sale' => __('Transaksi sudah dibatalkan.')]);
        }

        if ($sale->bonPayments()->exists()) {
            return back()->withErrors(['sale' => __('Tidak bisa membatalkan, bon sudah ada pembayaran.')]);
        }

        DB::transaction(function () use ($sale) {
            foreach ($sale->items as $item) {
                Product::whereKey($item->product_id)->increment('stok', $item->qty * $item->konversi);
            }

            $sale->update(['status' => 'dibatalkan']);
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Transaksi dibatalkan, stok dikembalikan.')]);

        return to_route('kasir');
    }
}
