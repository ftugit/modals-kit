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
};

// UnoCSS без хука `transformIndexHtml`. SvelteKit не пропускает `src/app.html` через этот
// хук и никогда не пропускал (sveltejs/kit#8269), а с 3.0 предупреждает о КАЖДОМ плагине,
// который его объявляет (`transform_index_html_unsupported`, sveltejs/kit#16394). У UnoCSS
// хук нужен только для index.html обычного Vite-приложения, здесь он мёртвый: CSS с ним
// и без него побайтно одинаков, а классы app.html сканируются явно (`content.filesystem`
// в unocss.config.ts). Тот же приём — varlock (dmno-dev/varlock#1199). Убрать, когда
// UnoCSS или SvelteKit (фильтр ложных срабатываний, sveltejs/kit#17373) решат это у себя.
const unocss = UnoCSS();
for (const plugin of unocss) delete plugin.transformIndexHtml;

export default defineConfig({
  // layer-guard идёт ПЕРВЫМ: запрещённый импорт роняет и dev, и build
  plugins: [layerGuard(RULES), unocss, sveltekit(kit)],
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
        './src/routes/(site)/+layout.svelte',
        './src/routes/(site)/ModalSystem.svelte',
        './src/routes/(site)/(app)/+page.svelte',
        './src/routes/(site)/(modals-demo)/modals/+page.svelte',
        './src/routes/cycle/+page.svelte',
        './src/routes/spike/+page.svelte',
        './src/routes/(site)/(app)/cards/[id]/+page.svelte',
        './src/app.css',
        './src/lib/components/shell/index.ts',
        './src/lib/components/shell/page.svelte.ts',
        './src/lib/components/shell/shell.svelte.ts',
        './src/lib/components/shell/AppShell.svelte',
        './src/lib/components/shell/PageHead.svelte',
        './src/lib/components/header/index.ts',
        './src/lib/components/sidebar/index.ts',
        './src/lib/components/modals/index.ts',
      ],
      ssrFiles: [
        './src/routes/+layout.svelte',
        './src/routes/(site)/+layout.svelte',
        './src/routes/(site)/ModalSystem.svelte',
        './src/routes/(site)/(app)/+page.svelte',
        './src/routes/(site)/(modals-demo)/modals/+page.svelte',
        './src/routes/cycle/+page.svelte',
        './src/routes/spike/+page.svelte',
        './src/routes/(site)/(app)/cards/[id]/+page.svelte',
      ],
    },
  },
});
