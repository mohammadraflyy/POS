<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreBonPaymentRequest;
use App\Models\Sale;
use Illuminate\Http\RedirectResponse;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

class BonPaymentController extends Controller
{
    public function store(StoreBonPaymentRequest $request, Sale $sale): RedirectResponse
    {
        if ($sale->metode_pembayaran !== 'bon' || $sale->status !== 'selesai') {
            throw ValidationException::withMessages([
                'jumlah' => __('Transaksi ini bukan bon aktif.'),
            ]);
        }

        $jumlah = $request->validated('jumlah');

        if ($jumlah > $sale->sisaPiutang()) {
            throw ValidationException::withMessages([
                'jumlah' => __('Jumlah bayar melebihi sisa piutang.'),
            ]);
        }

        $sale->bonPayments()->create([
            'jumlah' => $jumlah,
            'tanggal' => today(),
            'keterangan' => $request->validated('keterangan'),
        ]);

        $sale->increment('dibayar', $jumlah);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Pembayaran bon dicatat.')]);

        return back();
    }
}
