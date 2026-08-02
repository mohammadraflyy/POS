import type { Auth } from '@/types/auth';

declare module 'react' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface InputHTMLAttributes<T> {
        passwordrules?: string;
    }
}

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        sharedPageProps: {
            name: string;
            auth: Auth;
            sidebarOpen: boolean;
            storeSettings: {
                nama_toko: string;
                alamat: string | null;
                telepon: string | null;
                pesan_footer: string | null;
            };
            [key: string]: unknown;
        };
    }
}
