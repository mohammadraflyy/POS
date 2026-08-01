<?php

namespace Database\Factories;

use App\Models\Sale;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Sale>
 */
class SaleFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'nama_pelanggan' => null,
            'metode_pembayaran' => 'tunai',
            'status' => 'selesai',
            'total' => 0,
            'dibayar' => 0,
        ];
    }
}
