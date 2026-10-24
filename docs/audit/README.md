# Аудит кодовой базы

Материалы ревизии архитектуры, костылей, границ слоёв и очереди открытых доработок.

## Документы раздела

- **[`architecture.md`](./architecture.md)** — мастер-план и сквозной чек-лист (`S1` → `S6`, **все 6 этапов выполнены**): 5 верхних слоёв (`#lib/*`, `#hooks/*`, `#components/*`, `#content/*`, `#server/*`), папочные UI-модули `src/components/{fields,paginator}/`, изоляция витрин в `src/content/demo-catalog/`, автономный `src/content/user/{routes,modals}.ts` и единый реестр маршрутов в `#lib/address`.
- **[`ui-consistency.md`](./ui-consistency.md)** — ревизия принципа «один источник истины» в `src/components/ui` и `src/components/form` (`U1`–`U9`, `F1`–`F9`, **все 18 пунктов закрыты**, правила зафиксированы в [`../../src/components/ui/README.md`](../../src/components/ui/README.md)).
- **[`auth-session.md`](./auth-session.md)** — аудит жизненного цикла сессии и токенов (**выполнено и повторно верифицировано**: единый `vault` на замыкании без сырых токенов, Lamport-синхронизация вкладок, сериализованный `renew` и исправление всех находок `AS-01` .. `AS-09`).
- **[`testing-backlog.md`](./testing-backlog.md)** — актуальный статус задач `TB-01` .. `TB-15` после рефакторинга `S1`–`S6` и полного прогона тестов: закрытые пункты отделены от открытого бэклога с точными путями файлов.
- **[`ratings.md`](./ratings.md)** — историческая пофайловая оценка `src/` по критериям K1–K10 (срез до переезда папок `S5`).
- **[`crutches.md`](./crutches.md)** — подробный разбор исторических костылей (`C1`–`C10`), архитектурных дефектов и решений по их устранению.

## Связанные проектные документы

- **[`../plan.md`](../plan.md)** — сводный план разработки, выполненные этапы и оставшиеся задачи.
- **[`../design/port-plan.md`](../design/port-plan.md)** — пошаговый план переноса библиотек и приложения на другой фреймворк/роутер (шаги 2–5 доказаны в [`sim/react-router/`](../../sim/react-router/README.md)).
- **[`../design/image-transfer.md`](../design/image-transfer.md)** — конвейер бинарной передачи и обработки изображений (реализованное ядро и открытые этапы `R4`–`R7`).
- **[`../design/client-integrity.md`](../design/client-integrity.md)** — защита клиентского контура и конфигурация `kit.csp` к включению.

## Автоматические стражи (`tooling/`)

Инварианты аудита закреплены сборочными и тестовыми проверками:

| Страж | Что проверяет |
|---|---|
| `tooling/layer-guard.mjs` | Vite-плагин dev/build: направленность 5 верхних слоёв (`#lib` → `#hooks` → `#components` → `#content` → `#server`/`routes`), граница `*.server.ts` (включая SSR-контур Vite 8), чистота `src/server/trusted-origins.ts`, запрет прямого `history.pushState`/`replaceState`, чтения `page.url` и `goto` вне навигационных примитивов, запрет сырых `<form>`/`<input>`/`<select>`/`<textarea>` и рукописных `name=` вне кита, `.pending`/`.error` только в `takeover` и разбор тела только через `#lib/form/server.js`. |
| `tooling/core-purity.mjs` | Отсутствие импортов `svelte`, `@sveltejs/kit` и `$app/*` в чистых ядрах библиотек (`modals`, `form`, `paginate`, `address`, `fetch`, `cache`, `image`, `task`, `db`). |
| `tooling/load-url-guard.mjs` | Чтение URL в `load`-функциях маршрутов без скрытой потери реактивных зависимостей. |
| `tooling/source-schema-guard.mjs` | Изоляция схем внешних источников каталогов в зоне источника (`src/content/demo-catalog/`). |
| `tooling/db-docs.mjs` | Соответствие `src/lib/db/{README.md,PORTING.md,docs/*.md}` фактическим экспортам, кодам ошибок, лимитам, env-ключам, миграциям и путям файлов. |
| `tooling/classes-audit.mjs` | Отсутствие маркерных CSS-классов и утилит UnoCSS (включая `aria-*:` / `data-*:`) без сгенерированных правил. |
| `tooling/ark-owns.mjs` | Запрет ручного дублирования focus-trap, scroll-lock и возврата фокуса поверх машин Ark UI / Zag. |
| `tooling/form-size.mjs`, `tooling/size-budget.mjs` | Бюджеты gzip-веса ядра форм, общего клиентского бандла и начальной загрузки всех маршрутов. |
| `tooling/public-api.mjs` | Публичный вход пакетов `src/lib/<pkg>`: снаружи допустимы только спецификаторы из `entrypoints.json`. Запускается командой `node tooling/public-api.mjs` и тестом `tooling/public-api.test.mjs`; **в `vite.config.ts` не подключён** (открыто: см. отчёт аудита `S2`). |
