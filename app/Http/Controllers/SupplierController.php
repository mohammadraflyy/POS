<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSupplierRequest;
use App\Http\Requests\UpdateSupplierRequest;
use App\Models\Supplier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class SupplierController extends Controller
{
    public function index(Request $request): Response
    {
        $suppliers = Supplier::query()
            ->when($request->string('search')->toString(), function ($query, $search) {
                $query->where('nama', 'like', "%{$search}%");
            })
            ->withCount('purchases')
            ->orderBy('nama')
            ->paginate(20)
            ->withQueryString();

        return Inertia::render('supplier', [
            'suppliers' => $suppliers,
            'filters' => $request->only('search'),
        ]);
    }

    public function store(StoreSupplierRequest $request): RedirectResponse|JsonResponse
    {
        $supplier = Supplier::create($request->validated());

        if ($request->wantsJson()) {
            return response()->json($supplier);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Supplier ditambahkan.')]);

        return back();
    }

    public function update(UpdateSupplierRequest $request, Supplier $supplier): RedirectResponse
    {
        $supplier->update($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Supplier diperbarui.')]);

        return back();
    }

    public function destroy(Supplier $supplier): RedirectResponse
    {
        $supplier->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Supplier dihapus.')]);

        return back();
    }
}
