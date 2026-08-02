import { Form, Head } from '@inertiajs/react';
import { Printer, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import StoreController from '@/actions/App/Http/Controllers/Settings/StoreController';
import Heading from '@/components/heading';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Receipt } from '@/pages/kasir/shared';
import type { Sale } from '@/pages/kasir/shared';
import { edit } from '@/routes/store-settings';

type StoreSetting = {
    nama_toko: string;
    alamat: string | null;
    telepon: string | null;
    pesan_footer: string | null;
};

function dummySale(): Sale {
    return {
        id: 0,
        nama_pelanggan: null,
        metode_pembayaran: 'tunai',
        status: 'selesai',
        total: '25000',
        dibayar: '30000',
        created_at: new Date().toISOString(),
        user: { name: 'Test' },
        items: [
            {
                id: 1,
                qty: 2,
                satuan: 'PCS',
                harga_jual: '10000',
                subtotal: '20000',
                product: { id: 1, nama_item: 'Contoh Produk A' },
            },
            {
                id: 2,
                qty: 1,
                satuan: 'PCS',
                harga_jual: '5000',
                subtotal: '5000',
                product: { id: 2, nama_item: 'Contoh Produk B' },
            },
        ],
    };
}

function TestPrint() {
    const [testSale, setTestSale] = useState<Sale | null>(null);

    useEffect(() => {
        if (!testSale) {
            return;
        }

        let finished = false;

        function clear() {
            if (finished) {
                return;
            }

            finished = true;
            setTestSale(null);
        }

        window.print();

        window.addEventListener('afterprint', clear, { once: true });
        window.addEventListener('focus', clear, { once: true });

        return () => {
            window.removeEventListener('afterprint', clear);
            window.removeEventListener('focus', clear);
        };
    }, [testSale]);

    return (
        <>
            <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-1">
                    <p className="text-sm font-medium">Test Print</p>
                    <p className="text-sm text-muted-foreground">
                        Cetak struk contoh untuk memastikan printer struk
                        sudah terpasang dan ukuran kertas sudah benar.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTestSale(dummySale())}
                >
                    <Printer className="size-4" />
                    Test Print
                </Button>
            </div>
            {testSale && <Receipt sale={testSale} />}
        </>
    );
}

function TestScan() {
    const [lastScan, setLastScan] = useState<{
        code: string;
        at: string;
    } | null>(null);
    const scanBuffer = useRef('');
    const scanLastKeyAt = useRef(0);

    useEffect(() => {
        function isEditableFocused() {
            const el = document.activeElement;

            return (
                el instanceof HTMLElement &&
                (el.tagName === 'INPUT' ||
                    el.tagName === 'TEXTAREA' ||
                    el.isContentEditable)
            );
        }

        function handleKeydown(e: KeyboardEvent) {
            if (isEditableFocused()) {
                return;
            }

            const now = Date.now();

            if (now - scanLastKeyAt.current > 100) {
                scanBuffer.current = '';
            }

            scanLastKeyAt.current = now;

            if (e.key === 'Enter') {
                const code = scanBuffer.current;
                scanBuffer.current = '';

                if (code.length < 4) {
                    return;
                }

                e.preventDefault();
                setLastScan({
                    code,
                    at: new Date().toLocaleTimeString('id-ID'),
                });

                return;
            }

            if (e.key.length === 1) {
                scanBuffer.current += e.key;
            }
        }

        window.addEventListener('keydown', handleKeydown);

        return () => window.removeEventListener('keydown', handleKeydown);
    }, []);

    return (
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
                <p className="text-sm font-medium">Test Scanner</p>
                <p className="text-sm text-muted-foreground">
                    Klik di halaman ini lalu scan barcode apapun - kode yang
                    terbaca akan muncul di sini.
                </p>
                {lastScan && (
                    <p className="text-sm">
                        Terakhir dibaca:{' '}
                        <code className="rounded bg-muted px-1.5 py-0.5">
                            {lastScan.code}
                        </code>{' '}
                        <span className="text-muted-foreground">
                            ({lastScan.at})
                        </span>
                    </p>
                )}
            </div>
            <ScanLine className="size-5 shrink-0 text-muted-foreground" />
        </div>
    );
}

export default function Store({
    storeSetting,
}: {
    storeSetting: StoreSetting;
}) {
    return (
        <>
            <Head title="Pengaturan Toko" />

            <h1 className="sr-only">Pengaturan Toko</h1>

            <div className="space-y-6">
                <Heading
                    variant="small"
                    title="Toko"
                    description="Nama, alamat, dan pesan yang tampil di struk serta sidebar aplikasi"
                />

                <Form
                    {...StoreController.update.form()}
                    options={{ preserveScroll: true }}
                    className="space-y-6"
                >
                    {({ processing, errors }) => (
                        <>
                            <div className="grid gap-2">
                                <Label htmlFor="nama_toko">Nama Toko</Label>
                                <Input
                                    id="nama_toko"
                                    name="nama_toko"
                                    required
                                    defaultValue={storeSetting.nama_toko}
                                    placeholder="Toko Saya"
                                />
                                <InputError message={errors.nama_toko} />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="alamat">Alamat</Label>
                                <Input
                                    id="alamat"
                                    name="alamat"
                                    defaultValue={storeSetting.alamat ?? ''}
                                    placeholder="Jl. Contoh No. 1"
                                />
                                <InputError message={errors.alamat} />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="telepon">Telepon</Label>
                                <Input
                                    id="telepon"
                                    name="telepon"
                                    defaultValue={storeSetting.telepon ?? ''}
                                    placeholder="0812xxxxxxx"
                                />
                                <InputError message={errors.telepon} />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="pesan_footer">
                                    Pesan Footer Struk
                                </Label>
                                <Input
                                    id="pesan_footer"
                                    name="pesan_footer"
                                    defaultValue={
                                        storeSetting.pesan_footer ?? ''
                                    }
                                    placeholder="Terima kasih atas kunjungan Anda"
                                />
                                <InputError message={errors.pesan_footer} />
                            </div>

                            <Button disabled={processing}>Simpan</Button>
                        </>
                    )}
                </Form>

                <Heading
                    variant="small"
                    title="Test Perangkat"
                    description="Cek printer struk dan barcode scanner sebelum dipakai jualan"
                />

                <div className="space-y-3">
                    <TestPrint />
                    <TestScan />
                </div>
            </div>
        </>
    );
}

Store.layout = {
    breadcrumbs: [
        {
            title: 'Pengaturan Toko',
            href: edit(),
        },
    ],
};
