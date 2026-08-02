<?php

namespace App\Http\Controllers;

use App\Models\Purchase;
use App\Models\Sale;
use App\Models\SaleItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class RekapController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $from = $request->date('from') ?? today()->startOfMonth();
        $to = $request->date('to') ?? today();

        $selesaiInRange = Sale::query()
            ->where('status', 'selesai')
            ->whereBetween('created_at', [$from->copy()->startOfDay(), $to->copy()->endOfDay()]);

        $omzetTunai = (clone $selesaiInRange)->where('metode_pembayaran', 'tunai')->sum('total');
        $jumlahTransaksi = (clone $selesaiInRange)->count();
        $piutangBeredar = Sale::query()->where('status', 'selesai')->where('metode_pembayaran', 'bon')
            ->whereBetween('created_at', [$from->copy()->startOfDay(), $to->copy()->endOfDay()])
            ->selectRaw('SUM(total - dibayar) as piutang')
            ->value('piutang') ?? 0;

        $labaKotor = SaleItem::query()
            ->whereHas('sale', fn ($query) => $query->where('status', 'selesai')
                ->whereBetween('created_at', [$from->copy()->startOfDay(), $to->copy()->endOfDay()]))
            ->selectRaw('SUM(subtotal - (qty * konversi * harga_pokok)) as laba')
            ->value('laba') ?? 0;

        $labaPerKategori = SaleItem::query()
            ->join('products', 'products.id', '=', 'sale_items.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'selesai')
            ->whereBetween('sales.created_at', [$from->copy()->startOfDay(), $to->copy()->endOfDay()])
            ->groupBy('categories.id', 'categories.nama')
            ->orderByDesc('laba')
            ->get([
                DB::raw("COALESCE(categories.nama, 'Tanpa Kategori') as nama"),
                DB::raw('SUM(sale_items.subtotal) as omzet'),
                DB::raw('SUM(sale_items.subtotal - (sale_items.qty * sale_items.konversi * sale_items.harga_pokok)) as laba'),
            ]);

        $labaPerHari = SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'selesai')
            ->whereBetween('sales.created_at', [$from->copy()->startOfDay(), $to->copy()->endOfDay()])
            ->groupBy('tanggal')
            ->orderBy('tanggal')
            ->get([
                DB::raw('DATE(sales.created_at) as tanggal'),
                DB::raw('SUM(sale_items.subtotal) as omzet'),
                DB::raw('SUM(sale_items.subtotal - (sale_items.qty * sale_items.konversi * sale_items.harga_pokok)) as laba'),
            ]);

        $produkTerlaris = SaleItem::query()
            ->join('products', 'products.id', '=', 'sale_items.product_id')
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'selesai')
            ->whereBetween('sales.created_at', [$from->copy()->startOfDay(), $to->copy()->endOfDay()])
            ->groupBy('products.id', 'products.nama_item')
            ->orderByDesc('qty_terjual')
            ->limit(5)
            ->get([
                'products.nama_item',
                DB::raw('SUM(sale_items.qty) as qty_terjual'),
                DB::raw('SUM(sale_items.subtotal) as total_penjualan'),
            ]);

        $pembelianPerSupplier = Purchase::query()
            ->join('suppliers', 'suppliers.id', '=', 'purchases.supplier_id')
            ->whereBetween('purchases.tanggal', [$from, $to])
            ->groupBy('suppliers.id', 'suppliers.nama')
            ->orderByDesc('total_pembelian')
            ->get([
                'suppliers.nama',
                DB::raw('SUM(purchases.total) as total_pembelian'),
            ]);

        return Inertia::render('rekap', [
            'filters' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'summary' => [
                'omzet_tunai' => (float) $omzetTunai,
                'piutang_beredar' => (float) $piutangBeredar,
                'jumlah_transaksi' => $jumlahTransaksi,
                'laba_kotor' => (float) $labaKotor,
            ],
            'produkTerlaris' => $produkTerlaris,
            'pembelianPerSupplier' => $pembelianPerSupplier,
            'labaPerKategori' => $labaPerKategori,
            'labaPerHari' => $labaPerHari,
        ]);
    }
}
