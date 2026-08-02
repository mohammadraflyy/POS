<?php

namespace App\Http\Controllers;

use App\Http\Requests\BulkDestroyProductRequest;
use App\Http\Requests\BulkSaveProductRequest;
use App\Http\Requests\ImportProductRequest;
use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductPriceHistory;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Inertia\Inertia;
use Inertia\Response;
use PhpOffice\PhpSpreadsheet\IOFactory;

class ProductController extends Controller
{
    /** @var array<int, int> */
    private const PER_PAGE_OPTIONS = [10, 25, 50, 100];

    public function index(Request $request): Response
    {
        $perPage = $request->integer('per_page', 25);

        if (! in_array($perPage, self::PER_PAGE_OPTIONS, true)) {
            $perPage = 25;
        }

        $products = Product::query()
            ->with([
                'category:id,nama',
                'productUnits',
                'priceTiers',
                'priceHistories' => fn ($query) => $query->with('user:id,name')->latest()->limit(10),
            ])
            ->when($request->string('search')->toString(), function ($query, $search) {
                $query->where(function ($query) use ($search) {
                    $query->where('kode_item', 'like', "%{$search}%")
                        ->orWhere('nama_item', 'like', "%{$search}%")
                        ->orWhere('barcode', 'like', "%{$search}%");
                });
            })
            ->orderBy('nama_item')
            ->paginate($perPage)
            ->withQueryString();

        return Inertia::render('inventory', [
            'products' => $products,
            'filters' => $request->only('search', 'per_page'),
            'perPageOptions' => self::PER_PAGE_OPTIONS,
        ]);
    }

    /**
     * Live search for the command-palette quick search (`/` shortcut).
     */
    public function search(Request $request): JsonResponse
    {
        $q = $request->string('q')->toString();

        $products = Product::query()
            ->with('category:id,nama')
            ->when($q !== '', function ($query) use ($q) {
                $query->where(function ($query) use ($q) {
                    $query->where('kode_item', 'like', "%{$q}%")
                        ->orWhere('nama_item', 'like', "%{$q}%")
                        ->orWhere('barcode', 'like', "%{$q}%");
                });
            })
            ->orderBy('nama_item')
            ->limit(20)
            ->get(['id', 'kode_item', 'barcode', 'nama_item', 'category_id', 'satuan', 'harga_jual', 'is_active']);

        return response()->json($products);
    }

    /**
     * Mass input page: blank grid ("Mass Add"), or pre-loaded with the
     * given product ids for editing ("Mass Edit", `?ids=1,2,3`).
     */
    public function massInput(Request $request): Response
    {
        $ids = collect(explode(',', (string) $request->string('ids')))
            ->filter()
            ->map(fn (string $id): int => (int) $id)
            ->all();

        return Inertia::render('inventory/mass-input', [
            'initialProducts' => $ids === []
                ? []
                : Product::query()
                    ->whereIn('id', $ids)
                    ->with(['category:id,nama', 'productUnits', 'priceTiers'])
                    ->orderBy('nama_item')
                    ->get(),
        ]);
    }

    public function store(StoreProductRequest $request): RedirectResponse|JsonResponse
    {
        $product = Product::create([...$request->validated(), 'is_active' => true]);

        if ($request->wantsJson()) {
            return response()->json($product);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Produk ditambahkan.')]);

        return to_route('inventory');
    }

    public function update(UpdateProductRequest $request, Product $product): RedirectResponse
    {
        $categoryId = null;
        $kategori = $request->validated('kategori');

        if (! empty($kategori)) {
            $categoryId = Category::firstOrCreate(['nama' => $kategori])->id;
        }

        $hargaPokokLama = $product->harga_pokok;
        $hargaJualLama = $product->harga_jual;

        $product->update([
            ...$request->safe()->except('kategori'),
            'category_id' => $categoryId,
        ]);

        $this->logPriceChange($product, $hargaPokokLama, $hargaJualLama, $request->user()?->id);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Produk diperbarui.')]);

        return back();
    }

    public function destroy(Product $product): RedirectResponse
    {
        try {
            $product->delete();
        } catch (QueryException) {
            return back()->withErrors([
                'product' => __('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.'),
            ]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Produk dihapus.')]);

        return back();
    }

    public function bulkDestroy(BulkDestroyProductRequest $request): RedirectResponse
    {
        $blocked = [];
        $deleted = 0;

        foreach (Product::whereIn('id', $request->validated('ids'))->get() as $product) {
            try {
                $product->delete();
                $deleted++;
            } catch (QueryException) {
                $blocked[] = $product->nama_item;
            }
        }

        if ($blocked !== []) {
            return back()->withErrors([
                'product' => __(':n produk tidak bisa dihapus karena sudah punya riwayat transaksi: :list.', [
                    'n' => count($blocked),
                    'list' => implode(', ', $blocked),
                ]),
            ]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __(':n produk dihapus.', ['n' => $deleted])]);

        return back();
    }

    /**
     * Mass-save products from the Excel-like grid: each row without an `id`
     * is created, each row with an `id` is updated. All-or-nothing.
     */
    public function bulkSave(BulkSaveProductRequest $request): RedirectResponse
    {
        $rows = $request->validated('rows');

        DB::transaction(fn () => $this->saveRows($rows, $request->user()?->id));

        Inertia::flash('toast', ['type' => 'success', 'message' => __(':n produk disimpan.', ['n' => count($rows)])]);

        return to_route('inventory');
    }

    /**
     * Import a product catalog from an uploaded Excel/CSV export: rows
     * matching an existing `kode_item` are updated only if a field actually
     * differs (unchanged rows are skipped), unmatched rows are created.
     * Rows the parser can't make sense of are skipped rather than failing
     * the whole file, since real-world exports are rarely perfectly clean.
     */
    public function import(ImportProductRequest $request): RedirectResponse
    {
        [$rows, $skipped] = $this->parseImportFile($request->file('file'));

        $counts = DB::transaction(fn () => $this->saveRows($rows, $request->user()?->id));

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __(':created produk baru, :updated diperbarui, :unchanged tidak berubah, :skipped baris dilewati.', [
                ...$counts,
                'skipped' => $skipped,
            ]),
        ]);

        return to_route('inventory');
    }

    /**
     * Create-or-update each row (matching the mass-input grid's shape):
     * rows without an `id` are created, rows with an `id` are updated only
     * if something actually changed. Stock is only ever set on creation -
     * changes to existing stock flow through Purchase/StockAdjustment for
     * an audit trail.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array{created: int, updated: int, unchanged: int}
     */
    private function saveRows(array $rows, ?int $userId): array
    {
        $created = 0;
        $updated = 0;
        $unchanged = 0;

        foreach ($rows as $row) {
            $categoryId = null;

            if (! empty($row['kategori'])) {
                $categoryId = Category::firstOrCreate(['nama' => $row['kategori']])->id;
            }

            $attributes = [
                'kode_item' => $row['kode_item'],
                'barcode' => $row['barcode'] ?? null,
                'nama_item' => $row['nama_item'],
                'category_id' => $categoryId,
                'satuan' => $row['satuan'],
                'harga_pokok' => $row['harga_pokok'],
                'harga_jual' => $row['harga_jual'],
            ];

            if (! empty($row['id'])) {
                $product = Product::findOrFail($row['id']);
                $hargaPokokLama = $product->harga_pokok;
                $hargaJualLama = $product->harga_jual;

                $product->update($attributes);

                if ($product->wasChanged()) {
                    $updated++;
                    $this->logPriceChange($product, $hargaPokokLama, $hargaJualLama, $userId);
                } else {
                    $unchanged++;
                }
            } else {
                Product::create([
                    ...$attributes,
                    'stok' => $row['stok'] ?? 0,
                    'is_active' => true,
                ]);
                $created++;
            }
        }

        return ['created' => $created, 'updated' => $updated, 'unchanged' => $unchanged];
    }

    /**
     * Record an audit-trail entry when a product's prices actually changed.
     */
    private function logPriceChange(Product $product, string $hargaPokokLama, string $hargaJualLama, ?int $userId): void
    {
        if ($product->harga_pokok === $hargaPokokLama && $product->harga_jual === $hargaJualLama) {
            return;
        }

        ProductPriceHistory::create([
            'product_id' => $product->id,
            'user_id' => $userId,
            'harga_pokok_lama' => $hargaPokokLama,
            'harga_pokok_baru' => $product->harga_pokok,
            'harga_jual_lama' => $hargaJualLama,
            'harga_jual_baru' => $product->harga_jual,
        ]);
    }

    /**
     * Parse an uploaded catalog spreadsheet into rows shaped like the
     * mass-input grid. Locates the header row by looking for a "Kode Item"
     * cell (real-world exports often have a title/address block above the
     * actual table), then reads columns by header name so column order
     * doesn't matter.
     *
     * @return array{0: array<int, array<string, mixed>>, 1: int} [rows, skippedCount]
     */
    private function parseImportFile(UploadedFile $file): array
    {
        $sheetRows = IOFactory::load($file->getRealPath())
            ->getActiveSheet()
            ->toArray(null, true, true, false);

        $headerIndex = null;
        $columns = [];

        foreach ($sheetRows as $i => $sheetRow) {
            $resolved = $this->resolveImportColumns($sheetRow);

            if ($resolved !== null) {
                $headerIndex = $i;
                $columns = $resolved;
                break;
            }
        }

        if ($headerIndex === null) {
            return [[], 0];
        }

        $dataRows = array_slice($sheetRows, $headerIndex + 1);

        $kodeItems = array_unique(array_filter(array_map(
            fn ($sheetRow) => trim((string) ($sheetRow[$columns['kode_item']] ?? '')),
            $dataRows,
        )));

        $existingIds = Product::query()
            ->whereIn('kode_item', $kodeItems)
            ->pluck('id', 'kode_item');

        $rows = [];
        $skipped = 0;

        foreach ($dataRows as $sheetRow) {
            $kodeItem = trim((string) ($sheetRow[$columns['kode_item']] ?? ''));

            if ($kodeItem === '') {
                continue;
            }

            $namaItem = trim((string) ($sheetRow[$columns['nama_item']] ?? ''));
            $satuan = trim((string) ($sheetRow[$columns['satuan']] ?? ''));

            if ($namaItem === '' || $satuan === '') {
                $skipped++;

                continue;
            }

            $barcode = trim((string) ($sheetRow[$columns['barcode']] ?? ''));
            $kategori = trim((string) ($sheetRow[$columns['kategori']] ?? ''));

            $rows[] = [
                'id' => $existingIds[$kodeItem] ?? null,
                'kode_item' => $kodeItem,
                'barcode' => $barcode !== '' ? $barcode : null,
                'nama_item' => $namaItem,
                'kategori' => $kategori !== '' ? $kategori : null,
                'satuan' => $satuan,
                'harga_pokok' => $this->parseImportNumber($sheetRow[$columns['harga_pokok']] ?? 0),
                'harga_jual' => $this->parseImportNumber($sheetRow[$columns['harga_jual']] ?? 0),
                'stok' => (int) $this->parseImportNumber($sheetRow[$columns['stok']] ?? 0),
            ];
        }

        [$validRows, $invalidCount] = $this->validateImportRows($rows);

        return [$validRows, $skipped + $invalidCount];
    }

    /**
     * Match a spreadsheet row's cells against the expected column headers.
     * Returns a header-name => column-index map if this row looks like the
     * header row, or null otherwise.
     *
     * @param  array<int, mixed>  $sheetRow
     * @return array<string, int>|null
     */
    private function resolveImportColumns(array $sheetRow): ?array
    {
        /** @var array<string, array<int, string>> $labels */
        $labels = [
            'kode_item' => ['kode item'],
            'barcode' => ['kode barcode', 'barcode'],
            'nama_item' => ['nama item'],
            'kategori' => ['jenis', 'kategori'],
            'satuan' => ['satuan'],
            'harga_pokok' => ['harga beli', 'harga pokok'],
            'harga_jual' => ['harga jual'],
            'stok' => ['stok'],
        ];

        $found = [];

        foreach ($sheetRow as $index => $cell) {
            $text = strtolower(trim((string) $cell));

            if ($text === '') {
                continue;
            }

            foreach ($labels as $field => $candidates) {
                if (! isset($found[$field]) && in_array($text, $candidates, true)) {
                    $found[$field] = $index;
                }
            }
        }

        $required = ['kode_item', 'nama_item', 'satuan', 'harga_pokok', 'harga_jual'];

        if (count(array_intersect_key(array_flip($required), $found)) !== count($required)) {
            return null;
        }

        return $found;
    }

    private function parseImportNumber(mixed $value): float
    {
        if (is_numeric($value)) {
            return (float) $value;
        }

        $clean = str_replace([',', ' '], '', (string) $value);

        return is_numeric($clean) ? (float) $clean : 0.0;
    }

    /**
     * Drop rows that fail basic validation (rather than failing the whole
     * import) so a handful of malformed rows in a large real-world export
     * don't block everything else.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array{0: array<int, array<string, mixed>>, 1: int} [validRows, invalidCount]
     */
    private function validateImportRows(array $rows): array
    {
        $valid = [];
        $invalid = 0;

        foreach ($rows as $row) {
            $validator = Validator::make($row, [
                'kode_item' => ['required', 'string', 'max:50'],
                'barcode' => ['nullable', 'string', 'max:100'],
                'nama_item' => ['required', 'string', 'max:255'],
                'kategori' => ['nullable', 'string', 'max:255'],
                'satuan' => ['required', 'string', 'max:20'],
                'harga_pokok' => ['required', 'numeric', 'min:0'],
                'harga_jual' => ['required', 'numeric', 'min:0'],
                'stok' => ['nullable', 'integer', 'min:0'],
            ]);

            if ($validator->fails()) {
                $invalid++;

                continue;
            }

            $valid[] = $row;
        }

        return [$valid, $invalid];
    }
}
