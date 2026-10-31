import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vitest/config';
import { appHtmlScriptHashes, cspDirectives, trustedOrigins } from './src/server/trusted-origins.ts';
import { sveltekitWsPlugin } from './src/server/vite-ws.server.ts';
import { layerGuard, RULES } from './tooling/layer-guard.mjs';

const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 17)) {
  throw new Error(
    `modals-kit requires Node >= 22.17 (current: ${process.version}). Switch PATH to Node >= 22.17 before running Vite/Vitest.`,
  );
}

const appHtmlHashes = appHtmlScriptHashes(
  readFileSync(new URL('./src/app.html', import.meta.url), 'utf8'),
  (content) => createHash('sha256').update(content, 'utf8').digest('base64'),
);

// UnoCSS без хука `transformIndexHtml`. SvelteKit не пропускает `src/app.html` через этот
// хук и никогда не пропускал (sveltejs/kit#8269), а с 3.0 предупреждает о КАЖДОМ плагине,
// который его объявляет (`transform_index_html_unsupported`, sveltejs/kit#16394). У UnoCSS
// хук нужен только для index.html обычного Vite-приложения, здесь он мёртвый: CSS с ним
// и без него побайтно одинаков, а классы app.html сканируются явно (`content.filesystem`
// в unocss.config.ts). Тот же приём — varlock (dmno-dev/varlock#1199). Убрать, когда
// UnoCSS или SvelteKit (фильтр ложных срабатываний, sveltejs/kit#17373) решат это у себя.
const unocss = UnoCSS();
for (const plugin of unocss) delete plugin.transformIndexHtml;

export default defineConfig(({ command, isPreview }) => {
  const isDev = command === 'serve' && !isPreview;
  const getEnv = (key: string) => process.env[key];
  // Конфиг SvelteKit — опциями плагина `sveltekit()`. `csrf.trustedOrigins` и `csp` собираются
  // из чистых функций `src/server/trusted-origins.ts`; окружение — момент сборки/запуска dev.
  const kit = {
    adapter: adapter(),
    preprocess: vitePreprocess(),
    csrf: { trustedOrigins: trustedOrigins(getEnv, { dev: isDev }).exact },
    csp: {
      mode: 'auto' as const,
      directives: cspDirectives({
        get: getEnv,
        dev: isDev,
        inlineScriptHashes: appHtmlHashes,
      }),
    },
  };

  return {
    // В тестах svelte обязан резолвиться браузерной сборкой: иначе руны
    // ($effect/$effect.root) — серверные заглушки, и svelte-слой (bind)
    // тестировать нечем. Приём из документации Svelte по тестированию рун.
    resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
    // layer-guard идёт ПЕРВЫМ: запрещённый импорт роняет и dev, и build
    plugins: [layerGuard(RULES), unocss, sveltekitWsPlugin(), sveltekit(kit)],
  // tooling/*.test.mjs живут на node --test (чистый JS, без Vite) — сюда не берём
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    // В песочницах с ограниченным пулом исполняемых страниц V8 Liftoff падает по SIGSEGV
    // внутри WASM-инстансов `@electric-sql/pglite` (`Worker exited unexpectedly`);
    // компиляция `pglite.wasm` сразу через TurboFan (`--no-liftoff`) убирает падения,
    // но холодный старт одного `new PGlite()` занимает ~8.5 с (> дефолтных 5000 мс Vitest).
    execArgv: ['--no-liftoff'],
    testTimeout: 15_000,
    ...(totalmem() <= 4 * 1024 ** 3 || availableParallelism() <= 2 ? { maxWorkers: 1 } : {}),
  },
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
        './src/components/shell/index.ts',
        './src/components/shell/page.svelte.ts',
        './src/components/shell/shell.svelte.ts',
        './src/components/shell/AppShell.svelte',
        './src/components/shell/PageHead.svelte',
        './src/components/shell/ui/header/NavSlot.svelte',
        './src/components/shell/ui/sidebar/SidebarNav.svelte',
        './src/components/modals/index.ts',
      ].filter((f) => existsSync(new URL(f, import.meta.url))),
      ssrFiles: [
        './src/routes/+layout.svelte',
        './src/routes/(site)/+layout.svelte',
        './src/routes/(site)/ModalSystem.svelte',
        './src/routes/(site)/(app)/+page.svelte',
        './src/routes/(site)/(modals-demo)/modals/+page.svelte',
        './src/routes/cycle/+page.svelte',
        './src/routes/spike/+page.svelte',
        './src/routes/(site)/(app)/cards/[id]/+page.svelte',
      ].filter((f) => existsSync(new URL(f, import.meta.url))),
    },
  },
  };
});
