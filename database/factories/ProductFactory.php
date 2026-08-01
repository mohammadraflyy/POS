<?php

namespace Database\Factories;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Product>
 */
class ProductFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $hargaPokok = $this->faker->numberBetween(1000, 50000);

        return [
            'kode_item' => $this->faker->unique()->numerify('###'),
            'barcode' => null,
            'nama_item' => $this->faker->words(3, true),
            'category_id' => Category::factory(),
            'satuan' => $this->faker->randomElement(['PCS', 'DUS', 'PAK']),
            'harga_pokok' => $hargaPokok,
            'harga_jual' => $hargaPokok + $this->faker->numberBetween(500, 2000),
            'stok' => $this->faker->numberBetween(10, 100),
            'is_active' => true,
        ];
    }
}
