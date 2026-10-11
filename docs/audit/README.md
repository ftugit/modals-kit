# Аудит `src/`: «костыли», импорты фреймворка, оценка по спецификации SvelteKit

Состав:

| Файл | Что внутри |
|---|---|
| [framework-imports.md](framework-imports.md) | Где `src/lib` обращается к SvelteKit напрямую, минуя адаптеры (задача 4). |
| [crutches.md](crutches.md) | Реестр «костылей» с местом, причиной и правильной альтернативой (задача 3). |
| [ratings.md](ratings.md) | Оценка 0–10 каждого файла `src/` с обоснованием (задача 5). |

> **Пометка о переезде на SvelteKit 3 (ход 16, ветка `upgrade/kit3`).** Эти файлы — журнал решений, строки в них не
> переписываются. Пути вида `$lib/…`, `$env/…`, `$app/environment`, `svelte.config.js` относятся к коду **до** переезда:
> сейчас это `#lib/…` (полный путь с расширением, `package.json#imports`), `$app/env/private` + `src/env.ts`, `$app/env`
> и опции `sveltekit({...})` в `vite.config.ts`. План и нулевой список — `docs/design/kit3-upgrade.md`.

Объём: `src/` целиком — **387 файлов**: 376 из первоначального скана (338 исходных: 138 `.svelte`,
200 `.ts`, ≈42,9 тыс. строк; 38 тестов, ≈9,4 тыс. строк) плюс 11 файлов, которые скан пропустил
(ход 8): предскан смотрел только `.ts`/`.svelte`, поэтому выпали `src/lib/paginate/solid/adapter.tsx`
(1056 строк) и 10 проб `src/lib/db/probes/*.mjs|*.mts`. Скан исправлен (расширения
`.tsx/.mts/.mjs/.jsx`, тесты — `\.(test|spec)\.[mc]?[jt]sx?$`). `tooling/`, `test/`, `probes/` и корневые скрипты в аудит
не входят (решение владельца). Каждый файл читается **целиком**; оценка ставится только
прочитанному файлу. Пока чтение не закончено, в `ratings.md` у непрочитанных файлов стоит `⏳`.

## Методика

1. **Предскан** (`audit_scan.py`, лежит вне репозитория в `~/.agent/probes/`): число строк
   и автоматические признаки — legacy-синтаксис Svelte 4, `$effect`, импорты `$app/*`,
   `@sveltejs/kit`, `$env/*`, обращения к `window`/`history`, `any`, `@ts-*`, `svelte-ignore`,
   внутренние ключи SvelteKit, таймеры. Признак — повод посмотреть, а не вердикт.
2. **Чтение файла целиком** и сверка с критериями K1–K10 ниже.
3. **Проверка спорных мест**: подозрение на баг подтверждается пробой в браузере или тестом;
   неподтверждённое помечается «не проверено».

## Что такое «спецификация SvelteKit» в этом аудите

Официальная документация Svelte 5 и SvelteKit 2 (версии проекта: Svelte 5.57, SvelteKit 2.70):

| Код | Критерий | Источник |
|---|---|---|
| K1 | Svelte 5 runes; нет legacy-синтаксиса (`export let`, `$:`, `on:`, `<slot>`, `createEventDispatcher`, `$app/stores`). | [v5 migration guide](https://svelte.dev/docs/svelte/v5-migration-guide), [$app/stores (deprecated)](https://svelte.dev/docs/kit/$app-stores) |
| K2 | Реактивность: производное — `$derived`; `$effect` — только для внешних эффектов, не для синхронизации состояния; нет захвата начального значения пропса. | [$derived](https://svelte.dev/docs/svelte/$derived), [$effect — когда не использовать](https://svelte.dev/docs/svelte/$effect#When-not-to-use-$effect), [state_referenced_locally](https://svelte.dev/docs/svelte/compiler-warnings#state_referenced_locally) |
| K3 | Поток данных SvelteKit: `load`/form actions/`+server`, типы `./$types`, `$app/state`, навигация через `$app/navigation`, shallow routing по документации (`page.url` не меняется при `pushState`/`replaceState`). | [load](https://svelte.dev/docs/kit/load), [form actions](https://svelte.dev/docs/kit/form-actions), [shallow routing](https://svelte.dev/docs/kit/shallow-routing), [$app/state](https://svelte.dev/docs/kit/$app-state), [types](https://svelte.dev/docs/kit/types) |
| K4 | Граница сервер/клиент: серверное — в `$lib/server` или `*.server.ts`, секреты через `$env`, **нет общего изменяемого состояния на сервере**, `load` без побочных эффектов. | [server-only modules](https://svelte.dev/docs/kit/server-only-modules), [state management](https://svelte.dev/docs/kit/state-management) |
| K5 | SSR-безопасность: нет обращения к `window`/`document` вне браузера; разметка SSR и гидрации совпадает. | [state management](https://svelte.dev/docs/kit/state-management), [$app/environment](https://svelte.dev/docs/kit/$app-environment) |
| K6 | Прогрессивное улучшение: заявленное «работает без JS» действительно работает; формы — нативные с перехватом. | [form actions — progressive enhancement](https://svelte.dev/docs/kit/form-actions#Progressive-enhancement) |
| K7 | Доступность: правила a11y компилятора, роли, фокус, объявления маршрута. | [accessibility](https://svelte.dev/docs/kit/accessibility) |
| K8 | Слои: `src/lib` обращается к фреймворку через адаптеры; переносимая библиотека не импортирует `$app/*` (для окружения — `esm-env`); `lib` не зависит от прикладных папок. | [packaging](https://svelte.dev/docs/kit/packaging), [project structure](https://svelte.dev/docs/kit/project-structure) |
| K9 | Типизация: strict TS, без `any`/`@ts-ignore` без причины. | [TypeScript](https://svelte.dev/docs/svelte/typescript) |
| K10 | Сопровождаемость: одна ответственность, разумный размер, нет «костылей» (см. определение ниже). | — |

Файлы, которые к SvelteKit не относятся (чистые TS-ядра, биндинги Solid/React), оцениваются
по тем критериям, что к ним применимы (K4, K5, K8–K10). Это указано в замечании.

### Шкала

| Оценка | Смысл |
|---|---|
| 10 | Идиоматично; по документации менять нечего. |
| 8–9 | Мелкие замечания: лишний код, стиль, необязательные улучшения. |
| 6–7 | Заметные отступления от рекомендаций (обход адаптера, `$effect` для синхронизации, лишние `any`, перегруженный файл). |
| 4–5 | Нарушение правила документации с риском бага (общее состояние сервера, устаревший `page.url`, SSR-небезопасный код). |
| 0–3 | Подтверждённый баг или грубое нарушение. |

### Что считается «костылём»

Обход вместо решения причины: подавление предупреждения без исправления, таймер/микротаска
«чтобы успело», зависимость от внутренних (недокументированных) деталей фреймворка,
повторная реализация того, что фреймворк даёт штатно, `any`/`@ts-*` вместо типа,
дублирование чужой логики «на всякий случай». Сознательное и задокументированное отступление
с причиной записывается тоже, но с пометкой «обоснован».
