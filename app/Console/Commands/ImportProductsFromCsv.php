<?php

namespace App\Console\Commands;

use App\Models\Product;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('app:import-products-from-csv {path=database/data/produk-toko.csv}')]
#[Description('Import products from the legacy toko CSV export (kode_item, nama_item, kategori, satuan, harga_pokok, harga_jual)')]
class ImportProductsFromCsv extends Command
{
    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $path = $this->argument('path');

        if (! file_exists($path)) {
            $this->error("File not found: {$path}");

            return self::FAILURE;
        }

        $handle = fopen($path, 'r');
        $header = fgetcsv($handle);
        $imported = 0;

        while (($row = fgetcsv($handle)) !== false) {
            $data = array_combine($header, $row);

            Product::updateOrCreate(
                ['kode_item' => $data['kode_item']],
                [
                    'nama_item' => $data['nama_item'],
                    'kategori' => $data['kategori'] ?: null,
                    'satuan' => $data['satuan'],
                    'harga_pokok' => $data['harga_pokok'],
                    'harga_jual' => $data['harga_jual'],
                    'stok' => 0,
                    'is_active' => true,
                ],
            );

            $imported++;
        }

        fclose($handle);

        $this->info("Imported {$imported} products.");

        return self::SUCCESS;
    }
}
