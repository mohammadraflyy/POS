<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    /** Products at or below this stock level show up in the "Stok Menipis" widget. */
    private const LOW_STOCK_THRESHOLD = 5;

    public function __invoke(Request $request): Response
    {
        $today = today();
        $range = [$today->copy()->startOfDay(), $today->copy()->endOfDay()];

        $selesaiHariIni = Sale::query()
            ->where('status', 'selesai')
            ->whereBetween('created_at', $range);

        $omzetHariIni = (clone $selesaiHariIni)->where('metode_pembayaran', 'tunai')->sum('total');
        $jumlahTransaksiHariIni = (clone $selesaiHariIni)->count();

        $labaHariIni = SaleItem::query()
            ->whereHas('sale', fn ($query) => $query->where('status', 'selesai')->whereBetween('created_at', $range))
            ->selectRaw('SUM(subtotal - (qty * konversi * harga_pokok)) as laba')
            ->value('laba') ?? 0;

        $piutangBeredar = Sale::query()
            ->where('status', 'selesai')
            ->where('metode_pembayaran', 'bon')
            ->whereColumn('dibayar', '<', 'total')
            ->selectRaw('SUM(total - dibayar) as piutang')
            ->value('piutang') ?? 0;

        $stokMenipis = Product::query()
            ->where('is_active', true)
            ->where('stok', '<=', self::LOW_STOCK_THRESHOLD)
            ->orderBy('stok')
            ->limit(10)
            ->get(['id', 'kode_item', 'nama_item', 'satuan', 'stok']);

        $produkTerlarisHariIni = SaleItem::query()
            ->join('products', 'products.id', '=', 'sale_items.product_id')
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'selesai')
            ->whereBetween('sales.created_at', $range)
            ->groupBy('products.id', 'products.nama_item')
            ->orderByDesc('qty_terjual')
            ->limit(5)
            ->get([
                'products.nama_item',
                DB::raw('SUM(sale_items.qty) as qty_terjual'),
                DB::raw('SUM(sale_items.subtotal) as total_penjualan'),
            ]);

        $transaksiTerbaru = Sale::query()
            ->with('items.product:id,nama_item')
            ->latest()
            ->limit(5)
            ->get(['id', 'nama_pelanggan', 'metode_pembayaran', 'status', 'total', 'dibayar', 'created_at']);

        return Inertia::render('dashboard', [
            'summary' => [
                'omzet_hari_ini' => (float) $omzetHariIni,
                'jumlah_transaksi_hari_ini' => $jumlahTransaksiHariIni,
                'laba_hari_ini' => (float) $labaHariIni,
                'piutang_beredar' => (float) $piutangBeredar,
            ],
            'stokMenipis' => $stokMenipis,
            'produkTerlarisHariIni' => $produkTerlarisHariIni,
            'transaksiTerbaru' => $transaksiTerbaru,
        ]);
    }
}
