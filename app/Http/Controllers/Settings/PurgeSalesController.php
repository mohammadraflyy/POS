<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Http\Requests\Settings\PurgeSalesRequest;
use App\Models\Sale;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Carbon;
use Inertia\Inertia;

class PurgeSalesController extends Controller
{
    /**
     * Permanently delete every sale (and its items/bon payments, via
     * cascade) recorded before the given date - including bon that's
     * still outstanding, since the UI warns about that before submitting.
     */
    public function __invoke(PurgeSalesRequest $request): RedirectResponse
    {
        $before = Carbon::parse($request->validated('before'))->startOfDay();

        $deleted = Sale::where('created_at', '<', $before)->delete();

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __(':n transaksi dihapus.', ['n' => $deleted]),
        ]);

        return back();
    }
}
