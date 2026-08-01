<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->foreignId('category_id')->nullable()->after('kategori')->constrained()->nullOnDelete();
            $table->string('barcode')->nullable()->unique()->after('kode_item');
        });

        DB::table('products')
            ->select('kategori')
            ->whereNotNull('kategori')
            ->where('kategori', '!=', '')
            ->distinct()
            ->get()
            ->each(function ($row) {
                $categoryId = DB::table('categories')->insertGetId([
                    'nama' => $row->kategori,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                DB::table('products')->where('kategori', $row->kategori)->update(['category_id' => $categoryId]);
            });

        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('kategori');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('kategori')->nullable()->after('nama_item');
        });

        DB::table('products')
            ->join('categories', 'categories.id', '=', 'products.category_id')
            ->update(['products.kategori' => DB::raw('categories.nama')]);

        Schema::table('products', function (Blueprint $table) {
            $table->dropConstrainedForeignId('category_id');
            $table->dropColumn('barcode');
        });
    }
};
