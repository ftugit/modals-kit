import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vitest/config';
import { trustedOrigins } from './src/lib/server/trusted-origins.ts';
import { layerGuard, RULES } from './tooling/layer-guard.mjs';

// Конфиг SvelteKit — опциями плагина `sveltekit()`. `csrf.trustedOrigins` — точные адреса из того же списка, что у слоя 02
// форм (`src/lib/server/trusted-origins.ts`); окружение здесь — момент сборки/запуска dev.
const kit = {
  adapter: adapter(),
  preprocess: vitePreprocess(),
  csrf: { trustedOrigins: trustedOrigins((key) => process.env[key]).exact },
  // Переменные окружения — `src/env.ts` + `$app/env/private`. В 3.x это стабильный API,
  // флаг снимается вместе со сменой мажора (docs/design/kit3-upgrade.md, B1).
  experimental: { explicitEnvironmentVariables: true },
};

export default defineConfig({
  // layer-guard идёт ПЕРВЫМ: запрещённый импорт роняет и dev, и build
  plugins: [layerGuard(RULES), UnoCSS(), sveltekit(kit)],
  // tooling/*.test.mjs живут на node --test (чистый JS, без Vite) — сюда не берём
  test: { include: ['src/**/*.{test,spec}.{js,ts}'] },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
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
        './src/app.css',
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
