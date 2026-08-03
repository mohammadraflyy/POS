import { Link, usePage } from '@inertiajs/react';
import { Boxes, ClipboardList, ShoppingCart, Store } from 'lucide-react';
import { home } from '@/routes';
import type { AuthLayoutProps } from '@/types';

const highlights = [
    { icon: ShoppingCart, text: 'Transaksi cepat dengan scan barcode' },
    { icon: Boxes, text: 'Kelola stok dan pembelian di satu tempat' },
    { icon: ClipboardList, text: 'Laporan penjualan yang selalu terbaru' },
];

export default function AuthPosLayout({
    children,
    title,
    description,
}: AuthLayoutProps) {
    const { name } = usePage().props;

    return (
        <div className="grid min-h-svh lg:grid-cols-2">
            <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-10 text-white lg:flex">
                <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-white/10 blur-3xl" />

                <Link
                    href={home()}
                    className="relative z-10 flex items-center gap-2 text-lg font-semibold"
                >
                    <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
                        <Store className="size-5" />
                    </div>
                    {name}
                </Link>

                <div className="relative z-10 space-y-6">
                    <h2 className="text-3xl leading-tight font-semibold text-balance">
                        One app for your whole store's operations
                    </h2>
                    <ul className="space-y-4 text-sm text-indigo-100">
                        {highlights.map(({ icon: Icon, text }) => (
                            <li key={text} className="flex items-center gap-3">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15">
                                    <Icon className="size-4" />
                                </span>
                                {text}
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="relative z-10 text-xs text-indigo-200/70">
                    &copy; {name}
                </p>
            </div>

            <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
                <div className="mx-auto w-full max-w-sm">
                    <Link
                        href={home()}
                        className="mb-8 flex items-center gap-2 lg:hidden"
                    >
                        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                            <Store className="size-5" />
                        </div>
                        <span className="font-semibold">{name}</span>
                    </Link>

                    <div className="mb-8 space-y-1.5">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {description}
                        </p>
                    </div>

                    {children}
                </div>
            </div>
        </div>
    );
}
