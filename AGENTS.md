# AGENTS.md — правила и среда проекта `modals-kit`

Короткая памятка для coding-агентов. Стек: **SvelteKit 3**, **Svelte 5 (runes)**, **Vite 8 (Rolldown)**, **TypeScript 6**, **UnoCSS 66**, **Vitest 4**, **Playwright (Chromium)**, **PGlite / Postgres**.

## 1. Среда выполнения и быстрый старт

- **Node.js `>= 22.17` обязателен** (`package.json#engines` и явная проверка в `vite.config.ts`): сборка и пререндер SvelteKit 3 используют `Promise.withResolvers`. Если в контейнере по умолчанию стоит более старый `/usr/bin/node`, перед первой командой переключи `PATH` / `/usr/local/bin/{node,npm,npx}` на установленный `Node >= 22.17` (например, в `/opt/node-v24*`).
- **WASM `PGlite` в тестах (`--no-liftoff` + `testTimeout: 15_000`):** на Node 24 в облачных контейнерах с ограниченным пулом исполняемых страниц WASM baseline-компилятор V8 Liftoff роняет дочерние процессы `PGlite` по `SIGSEGV` (`Worker exited unexpectedly`). В `vite.config.ts` настроены `execArgv: ['--no-liftoff']`, `testTimeout: 15_000` (холодная компиляция `pglite.wasm` в TurboFan занимает ~8.5 с против дефолтных `5000` мс) и `maxWorkers: 1` для контейнеров `<= 4 GiB` / `<= 2` vCPU — штатный `npm test` стабильно проходит на `100%` с холодного кэша без дополнительных флагов.
- **Снимки песочниц:** каталоги `node_modules`, `.svelte-kit`, `.playwright*` и `.git/config` часто исключаются из снапшотов среды. При продолжении сессии одной командой проверь `node -v`, `git status -sb`, наличие `node_modules` и системных библиотек Chromium.

## 2. Цикл проверки (быстрый контур → финальные гейты)

Не гоняй полный Vitest и все браузерные сьюты после каждой правки:

1. **Во время разработки (5–10 с):**
   - только затронутые тесты: `npx vitest run <путь-к-модулю>`
   - типы и шаблоны (при остановленном `vite dev`, чтобы не конкурировать за `.svelte-kit/`): `npm run check`
   - аудит классов и границ слоёв: `npm run test:classes && npm run test:guard`
2. **Один раз перед коммитом (полный набор гейтов):**
   - `npm run test:classes` (`node tooling/classes-audit.mjs` — `Маркер-классов: 0`)
   - `npm run check` (`0 errors and 0 warnings`)
   - `npm test` (`vitest run && node --test tooling/*.test.mjs`)
   - `npm run build`
   - `npm run test:size` (`node tooling/size-budget.mjs`)
3. **Браузерные проверки (`test/browser/*.mjs` на порту `5173`):**
   - Маршрутные E2E-наборы (`forms.mjs`, `forms-a11y.mjs`, `fields.mjs`, `modals.mjs`, `shell.mjs`, `steps.mjs`, `paginator.mjs`, `db-demo.mjs`, `regressions.mjs`, `capabilities.mjs`, `errors.mjs`) запускай против **собранного `npm run preview`** — на `1–2 vCPU` холодная компиляция `vite dev` может давать ложные таймауты гидратации.
   - Набор `node test/browser/attachment.mjs` динамически импортирует исходную `.test.svelte`-фикстуру через Vite module graph — запускай его против **`npm run dev`**.

## 3. Архитектурные инварианты и охранники (`tooling/`)

- **Границы слоёв (`tooling/layer-guard.mjs` + `tooling/*.test.mjs`):**
  - Ядра библиотек (`src/lib/modals`, `src/lib/form`, `src/lib/paginate`, `src/lib/address`, `src/lib/cache`, `src/lib/fetch`) не импортируют Svelte, SvelteKit и внешние пакеты (кроме разрешённых правил слоя).
  - Сырые HTML-теги форм и контролов (`form`, `input`, `select`, `textarea`) разрешены **только** внутри UI-примитивов `src/lib/components/ui/**` и `Form.svelte` (в остальных файлах охранник режет даже буквальные вхождения в шаблонах/строках).
  - Адрес читается через `visibleAddress` / `event.url`, а не через `page.url`, `window.history` или `event.request.url` в `load`.
- **Токены и классы (`unocss.config.ts` + `tooling/classes-audit.mjs`):**
  - Только семантические токены темы (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-input`, `bg-primary`, `text-destructive`, `ring-ring` и т.д.), локальные `cn()` и `variants()` из `#lib/utils/ui.js`.
  - Ноль пустых/несуществующих маркер-классов: для тестовых и структурных привязок используй `data-slot="..."` / ARIA-атрибуты.
- **Прогрессивное улучшение (SSR / без JS):**
  - Любая форма и любой базовый контрол обязаны работать без JavaScript на нативной серверной разметке. Интерактивные кнопки, зависящие от клиентского JS (например, `DataTransfer`, `objectURL`, кастомные попапы), монтируются только после гидратации (`mounted`), чтобы в SSR не было мёртвых контролов.
- **Бюджеты веса (`tooling/size-budget.mjs`):**
  - `#lib/components/ui/index.js` — общая бочка UI-примитивов. Динамический `import()` внутри компонента, который уже реэкспортирован из этой бочки, не создаёт отдельный чанк, а вызывает предупреждение Rolldown `[INEFFECTIVE_DYNAMIC_IMPORT]` и добавляет лишнюю обёртку. Держи шаблоны и SVG внутри общих примитивов компактными; правила пересмотра `LIMITS` и `ROUTE_LIMITS` подробно описаны в комментариях `tooling/size-budget.mjs`.
