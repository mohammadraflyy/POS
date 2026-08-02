import { Form, Head } from '@inertiajs/react';
import StoreController from '@/actions/App/Http/Controllers/Settings/StoreController';
import Heading from '@/components/heading';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { edit } from '@/routes/store-settings';

type StoreSetting = {
    nama_toko: string;
    alamat: string | null;
    telepon: string | null;
    pesan_footer: string | null;
};

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
