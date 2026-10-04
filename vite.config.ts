import UnoCSS from 'unocss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { layerGuard, RULES } from './tooling/layer-guard.mjs';

export default defineConfig({
  // layer-guard идёт ПЕРВЫМ: запрещённый импорт роняет и dev, и build
  plugins: [layerGuard(RULES), UnoCSS(), sveltekit()],
  // tooling/*.test.mjs живут на node --test (чистый JS, без Vite) — сюда не берём
  test: { include: ['src/**/*.{test,spec}.{js,ts}'] },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // превью проксируется через внешний хост песочницы
    allowedHosts: true,
    strictPort: true,
    warmup: {
      clientFiles: [
        './src/routes/+layout.svelte',
        './src/routes/+page.svelte',
        './src/routes/modals/+page.svelte',
        './src/routes/cycle/+page.svelte',
        './src/routes/spike/+page.svelte',
        './src/routes/cards/[id]/+page.svelte',
        './src/lib/styles/tokens.css',
        './src/lib/styles/shell.css',
        './src/lib/modals/css/modals-base.css',
        './src/lib/modals/css/modals-theme.css',
        './src/lib/shell/index.ts',
        './src/lib/shell/page.svelte.ts',
        './src/lib/shell/shell.svelte.ts',
        './src/lib/shell/AppShell.svelte',
        './src/lib/shell/PageHead.svelte',
        './src/lib/components/header/index.ts',
        './src/lib/components/sidebar/index.ts',
        './src/lib/ui/modals/index.ts',
      ],
      ssrFiles: [
        './src/routes/+layout.svelte',
        './src/routes/+page.svelte',
        './src/routes/modals/+page.svelte',
        './src/routes/cycle/+page.svelte',
        './src/routes/spike/+page.svelte',
        './src/routes/cards/[id]/+page.svelte',
      ],
    },
  },
});
