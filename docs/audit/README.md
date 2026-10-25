# Аудит кодовой базы

Материалы ревизии архитектуры, костылей, границ слоёв и очереди открытых доработок.

## Документы раздела

- **[`open-issues.md`](./open-issues.md)** — только нерешённое: три вопроса без ответа (`OI-07`, `OI-17`, `OI-19`) и восемь открытых работ; ответы и принятые решения не дублируются, на них даны ссылки — [`../plan.md`](../plan.md) §2–§3, [`../design/`](../design/).
- **[`crutches.md`](./crutches.md)** — разбор исторических костылей (`C1`–`C13`) и багов (`F1`–`F54`) с причинами решений; на него ссылаются комментарии в коде, поэтому документ живёт как журнал «почему так».

Закрытые чек-листы (`architecture.md` — `S1`–`S6`, `ui-consistency.md` — `U1`–`U9`/`F1`–`F9`, `auth-session.md` — `AS-01`–`AS-09`, `ratings.md` — пофайловая оценка) удалены при чистке документации: инварианты, которые они фиксировали, теперь живут там, где их проверяют — в [`AGENTS.md`](../../AGENTS.md), [`src/components/ui/README.md`](../../src/components/ui/README.md), README пакетов `src/lib/*` и стражах `tooling/`.

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
| `tooling/public-api.mjs` | Публичный вход пакетов `src/lib/<pkg>`: снаружи допустимы только спецификаторы из `entrypoints.json`. Прогоняется тестом `tooling/public-api.test.mjs` в составе `test:guard` (`node --test tooling/*.test.mjs`) и вручную — `node tooling/public-api.mjs`; отдельного vite-плагина нет намеренно: проверка статическая, ей не нужен граф сборки. |
