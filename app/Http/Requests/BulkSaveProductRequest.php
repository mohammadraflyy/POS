<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class BulkSaveProductRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $rules = [
            'rows' => ['required', 'array', 'min:1'],
        ];

        foreach ($this->input('rows', []) as $index => $row) {
            $id = $row['id'] ?? null;

            $rules["rows.$index.id"] = ['nullable', 'integer', 'exists:products,id'];
            $rules["rows.$index.kode_item"] = ['required', 'string', 'max:50', Rule::unique('products', 'kode_item')->ignore($id)];
            $rules["rows.$index.barcode"] = ['nullable', 'string', 'max:100', Rule::unique('products', 'barcode')->ignore($id)];
            $rules["rows.$index.nama_item"] = ['required', 'string', 'max:255'];
            $rules["rows.$index.kategori"] = ['nullable', 'string', 'max:255'];
            $rules["rows.$index.satuan"] = ['required', 'string', 'max:20'];
            $rules["rows.$index.harga_pokok"] = ['required', 'numeric', 'min:0'];
            $rules["rows.$index.harga_jual"] = ['required', 'numeric', 'min:0'];
            $rules["rows.$index.stok"] = ['nullable', 'integer', 'min:0'];
        }

        return $rules;
    }

    /**
     * Reject kode_item/barcode duplicated across rows within the same request.
     *
     * @return array<int, callable>
     */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                $seenKodeItem = [];
                $seenBarcode = [];

                foreach ($this->input('rows', []) as $index => $row) {
                    $kodeItem = $row['kode_item'] ?? null;

                    if ($kodeItem !== null) {
                        if (isset($seenKodeItem[$kodeItem])) {
                            $validator->errors()->add("rows.$index.kode_item", __('Kode item duplikat pada baris ini.'));
                        }

                        $seenKodeItem[$kodeItem] = true;
                    }

                    $barcode = $row['barcode'] ?? null;

                    if ($barcode !== null && $barcode !== '') {
                        if (isset($seenBarcode[$barcode])) {
                            $validator->errors()->add("rows.$index.barcode", __('Barcode duplikat pada baris ini.'));
                        }

                        $seenBarcode[$barcode] = true;
                    }
                }
            },
        ];
    }
}
