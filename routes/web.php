<?php

use App\Http\Controllers\BonPaymentController;
use App\Http\Controllers\CategoryController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\ProductPriceTierController;
use App\Http\Controllers\ProductUnitController;
use App\Http\Controllers\PurchaseController;
use App\Http\Controllers\RekapController;
use App\Http\Controllers\SaleController;
use App\Http\Controllers\StockAdjustmentController;
use App\Http\Controllers\SupplierController;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'welcome')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    Route::get('kasir', [SaleController::class, 'index'])->name('kasir');
    Route::post('kasir', [SaleController::class, 'store'])->name('kasir.store');
    Route::get('kasir/history', [SaleController::class, 'history'])->name('kasir.history');
    Route::post('kasir/{sale}/cancel', [SaleController::class, 'cancel'])->name('kasir.cancel');
    Route::post('kasir/{sale}/bon-payments', [BonPaymentController::class, 'store'])->name('kasir.bon-payments.store');

    Route::get('supplier', [SupplierController::class, 'index'])->name('supplier');
    Route::post('supplier', [SupplierController::class, 'store'])->name('supplier.store');
    Route::put('supplier/{supplier}', [SupplierController::class, 'update'])->name('supplier.update');
    Route::delete('supplier/{supplier}', [SupplierController::class, 'destroy'])->name('supplier.destroy');

    Route::get('stock-opname', [StockAdjustmentController::class, 'index'])->name('stock-opname');
    Route::get('stock-opname/search', [StockAdjustmentController::class, 'search'])->name('stock-opname.search');
    Route::post('stock-opname/{product}', [StockAdjustmentController::class, 'store'])->name('stock-opname.store');

    Route::get('rekap', RekapController::class)->name('rekap');

    Route::get('inventory', [ProductController::class, 'index'])->name('inventory');
    Route::post('inventory', [ProductController::class, 'store'])->name('inventory.store');
    Route::put('inventory/{product}', [ProductController::class, 'update'])->name('inventory.update');
    Route::delete('inventory/{product}', [ProductController::class, 'destroy'])->name('inventory.destroy');
    Route::delete('inventory', [ProductController::class, 'bulkDestroy'])->name('inventory.bulk-destroy');
    Route::get('inventory/search', [ProductController::class, 'search'])->name('inventory.search');
    Route::get('inventory/mass-input', [ProductController::class, 'massInput'])->name('inventory.mass-input');
    Route::post('inventory/stock-in', [PurchaseController::class, 'store'])->name('inventory.stock-in');
    Route::post('inventory/{product}/units', [ProductUnitController::class, 'store'])->name('inventory.units.store');
    Route::delete('inventory/{product}/units/{productUnit}', [ProductUnitController::class, 'destroy'])->name('inventory.units.destroy');
    Route::post('inventory/{product}/price-tiers', [ProductPriceTierController::class, 'store'])->name('inventory.price-tiers.store');
    Route::delete('inventory/{product}/price-tiers/{priceTier}', [ProductPriceTierController::class, 'destroy'])->name('inventory.price-tiers.destroy');
    Route::post('inventory/bulk', [ProductController::class, 'bulkSave'])->name('inventory.bulk-save');

    Route::post('categories', [CategoryController::class, 'store'])->name('categories.store');
});

require __DIR__.'/settings.php';
