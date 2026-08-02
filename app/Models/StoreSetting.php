<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['nama_toko', 'alamat', 'telepon', 'pesan_footer'])]
class StoreSetting extends Model
{
    /**
     * The single row of store settings, created with sane defaults the
     * first time it's needed instead of requiring a seeder.
     */
    public static function current(): self
    {
        return static::query()->firstOrCreate([], [
            'nama_toko' => config('app.name'),
        ]);
    }
}
