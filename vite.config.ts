import inertia from '@inertiajs/vite';
import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { bunny } from 'laravel-vite-plugin/fonts';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    // VITE_DEV_HOST is optional and machine-specific (set it in your local
    // .env, never commit an IP here) - it binds the dev server to that
    // address instead of localhost-only, so it's reachable from other
    // devices on the same network.
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [
            laravel({
                input: ['resources/css/app.css', 'resources/js/app.tsx'],
                refresh: true,
                fonts: [
                    bunny('Instrument Sans', {
                        weights: [400, 500, 600],
                    }),
                ],
            }),
            inertia(),
            react({
                babel: {
                    plugins: ['babel-plugin-react-compiler'],
                },
            }),
            tailwindcss(),
            wayfinder({
                formVariants: true,
            }),
        ],
        server: env.VITE_DEV_HOST
            ? {
                  // Bind every interface (localhost included) so both work,
                  // but pin the asset URLs written to the hot file at the
                  // LAN address specifically - Vite would otherwise report
                  // its literal 0.0.0.0/[::] bind address there, which no
                  // browser can actually connect to.
                  host: true,
                  hmr: { host: env.VITE_DEV_HOST },
              }
            : undefined,
    };
});
