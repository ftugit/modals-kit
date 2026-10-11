# План: переезд на SvelteKit 3 без остатков v2

Статус: **план, переезд не начат.** Решения владельца:
- ход 13: «делай план под этот случай, сейчас оставь как есть»;
- ход 14: «мусорных функций и файлов после v2 не должно остаться»; аудит `lib/db` и `lib/ui` продолжается **после** переезда.

Сейчас стоит `@sveltejs/kit` 2.70.3 (последняя 2.x, 2026-08-18), Svelte 5.57.1, Vite 8.3.1, TS ^6.0.3,
vite-plugin-svelte ^7.1.2, svelte-check ^4.6.0, Node в песочнице 20.20.2.
Цель: `@sveltejs/kit` 3.0.x (на 2026-10-11 `latest` = 3.0.1).

Критерий готовности: **все пункты «нулевого списка» (§8) дают 0 вхождений**, а гейт, браузерные наборы и
ручной обход сайта зелёные. Если код просто «работает на 3.x», переезд не считается законченным.

---

## 0. Коротко

1. **Переезд в три фазы, а не одним прыжком.** Бо́льшая часть замен уже работает на 2.70.3:
   - конфиг в `vite.config.ts` (с 2.62);
   - явные env-переменные (с 2.62, экспериментально);
   - `$app/env`, `refreshAll`, `Response.json`.

   Эти замены (фаза A) идут в master маленькими обратимыми коммитами на 2.x. Фаза B — только то, что
   невозможно без 3.x. Фаза C снимает обходы, ради которых всё затевается.
2. **`npx sv migrate` на рабочем дереве не запускаем.** В открытом [cli#1392] перепечатка шаблонов
   меняет видимый текст и раскодирует `&lt;`/`&gt;` в теги. У нас это
   `PaginatorDemo.svelte:55` (`?page.&lt;опция&gt;` станет тегом `<опция>`) и ещё 26 мест вида `</code>,`.
   Инструмент запускаем на одноразовой копии как **сверочный список задач**, а правки вносим вручную или
   кодмодом, который меняет только строку импорта.
3. **С фазой B не торопиться, но и не ждать долго.** Даты и источники — в §2. Мое предложение (решать
   владельцу): фаза A — сразу после ответов владельца; фаза B — когда выполнены условия старта из §2.3.

---

## 1. Источники

Официальные (прочитаны полностью или по разделам):
- полная документация Kit в формате для LLM: `https://svelte.dev/docs/kit/llms.txt`, 18 640 строк, проверено 2026-10-11;
  - выборка всех `[!LEGACY]`, `deprecated`, `removed in`, `SvelteKit 4` — основа §5–§8;
- [руководство по миграции](https://svelte.dev/docs/kit/migrating-to-sveltekit-3);
- [Environment variables](https://svelte.dev/docs/kit/environment-variables), [Server-only modules](https://svelte.dev/docs/kit/server-only-modules),
  [`#lib`](https://svelte.dev/docs/kit/$lib), [`$app/tsconfig`](https://svelte.dev/docs/kit/$app-tsconfig), [shallow routing](https://svelte.dev/docs/kit/shallow-routing);
- [блог «SvelteKit 3 is here»](https://svelte.dev/blog/sveltekit-3-is-here) (2026-10-01) и release notes `@sveltejs/kit@3.0.0` / `3.0.1`;
- типы `@sveltejs/kit` 2.70.3 и 3.0.1 (unpkg): сверка, что есть в какой версии (§5);
- [бюллетени безопасности kit](https://github.com/sveltejs/kit/security/advisories);
- release notes `sv` 1.0.0–1.1.1.

Обсуждение и опыт других проектов:
- [cli#1392] — `sv migrate`: падения, перепечатка текста, поведенческие правки;
- [cli#1369] — проверка `ORIGIN` не видит `.env`;
- открытые issues kit, созданные с 2026-10-01 (24 шт.);
- [HN: SvelteKit 3](https://news.ycombinator.com/item?id=49926536);
- byteiota «What sv migrate Misses»;
- PR переездов: haruspex #337/#341, per-ankh #271, tellegen #156, next-auth#13502, omnileaf#314.

[cli#1392]: https://github.com/sveltejs/cli/issues/1392
[cli#1369]: https://github.com/sveltejs/cli/issues/1369

---

## 2. Торопиться или ждать

### 2.1 Причины не торопиться

| Факт | Дата / источник | Что значит для нас |
|---|---|---|
| 3.0.0 вышла 2026-10-01; 3.0.1 (2026-10-06) содержит одну правку — типы под `nodenext` (#17351) | npm `time` | мажору 10 дней, один патч |
| 24 открытых issue, созданных с 2026-10-01 (см. справа) | список issues kit | среди них то, что затрагивает нас:<br>• **#17346** — статически импортированный чанк теряет `modulepreload` и CSS, если до него первым дошёл динамический импорт. У нас 35 динамических импортов (загрузчики модалок и маршрутов) → возможна вспышка без стилей;<br>• **#17383** — падение гидратации при async-контенте с pending-границей. У нас `<svelte:boundary>` нет → не затрагивает, но держим в виду;<br>• **#17311** — `new URL(page.url)` даёт ошибку типов (`page.url` теперь readonly). У нас такого вызова нет;<br>• **#17394** — `svelte-kit sync` генерирует типы дважды;<br>• **#17393** — дашборд Vercel ищет удалённый `svelte.config.js`. Касается нас, если деплой на Vercel (есть `vercel.json`) |
| `sv migrate` (sv 1.0.1 → 1.1.1) | [cli#1392] (2026-10-03), sv 1.1.1 (2026-10-06) | **исправлено в 1.1.1:**<br>• `$lib` переписывается по всему проекту;<br>• конфликт имён при слиянии конфигов;<br>• хуки навигации;<br>• разбор `</script>`.<br>**Открыто:**<br>• перепечатка меняет текст (п. 3) — бьёт по нам, см. §0.2;<br>• схемы env `input => input ?? ''` ломают `A ?? B` (п. 8);<br>• всегда пишет `"#lib": "./src/lib/index.js"` («not fixing»), а у нас `index.ts` |
| npm, поставляемый с Node 22 (до 11.5.0), падает на свежей установке Kit 3 с ошибкой резолвера | byteiota, 2026-10-10 | у нас Node 20 — менять всё равно. Брать Node 24 или проверить версию npm |
| TypeScript 7.0.2 уже вышел, а peer Kit 3.0.1 — `typescript ^6.0.0` | npm | после переезда TS закреплён на 6 до поддержки 7 в Kit. Не блокер, но держим в виду |
| `svelte.config.js` больше не читается вовсе. Скрипты CI/деплоя, которые на него ссылаются, молча ломаются | руководство, byteiota, per-ankh#271 | у нас его читают:<br>• `tooling/env-docs.mjs` (`SCANNED_FILES`);<br>• комментарии в `.env.example` и `form-security.ts`;<br>• `test/browser/db-demo-browser.check.mjs` |

### 2.2 Причины не ждать долго

| Факт | Дата / источник | Что значит для нас |
|---|---|---|
| Четыре бюллетеня от **2026-10-05** исправлены **только в 3.0.0**, для 2.x исправлений нет (затронуты все версии `< 3.0.0`):<br>• SSRF через редиректы в серверном self-fetch (Moderate, GHSA-prjg-x2qj-wj3g);<br>• open redirect через `use:enhance` (Low, GHSA-pfhg-q3qv-9q6r);<br>• XSS через cache-control в prerender (Low, GHSA-27mw-82g8-phjj);<br>• path traversal в `vite preview` на Windows (Moderate, GHSA-xgrj-p7pg-6vm3) | [advisories](https://github.com/sveltejs/kit/security/advisories) | подверженность **низкая**:<br>• `use:enhance` в коде приложения нет;<br>• prerender нет;<br>• catch-all маршрутов нет;<br>• `load` не ходит fetch'ем к себе же;<br>• песочница на Linux.<br>Но это прецедент: исправления безопасности получает только 3.x |
| `npm audit`: `@sveltejs/kit ≤ 2.70.3` → `cookie <0.7` (GHSA-pxg6-pf52-xh8x, low); исправление только мажором (cookie v2 в Kit 3). Через kit помечены и `adapter-auto` ≤ 7.0.1 и `adapter-vercel` ≤ 6.3.4 | `npm audit`, 2026-10-11 | шум в аудите, пока мы на 2.x |
| «2.x больше не получает релизов, включая исправления безопасности из 3.0» | omnileaf#314 (неофициально) | бюллетени выше это подтверждают на деле |
| `$app/environment` и все `$env/*` устарели в 3 и **будут удалены в SvelteKit 4** | документация (`$app/environment`, `$env/*`, Environment variables) | переход через «оставим устаревшее, раз работает» лишь откладывает ту же работу |

### 2.3 Условия старта фазы B (предложение; решать владельцу)

1. Фаза A влита в master, гейт и браузерные наборы зелёные.
2. Песочница и деплой на Node ≥ 22.17 с рабочим npm (лучше Node 24); в `package.json` задан `engines.node`.
3. В 3.0.x исправлен **#17346** (потеря `modulepreload`/CSS), либо наш браузерный прогон на ветке
   показал, что вспышки нет (`modals`, `shell`, `regressions` + проверка стилей у лениво загружаемых модалок).
4. Ответы на вопросы владельца (§10).

Пока условия 2–4 не выполнены, фаза A всё равно имеет смысл: она уменьшает дифф прыжка и
сама по себе убирает устаревшее.

---

## 3. Что 3.x решает (ради чего переезд)

Одна причина у большинства случаев: в 2.x «мелкая» запись адреса (`pushState`/`replaceState` из `$app/navigation`)
не меняет `page.url`, не вызывает хуки навигации, а у `preloadData` нет исхода «ошибка». Проект обходит это вручную.

| Находка | Как обходим в 2.x | Что даёт 3.x |
|---|---|---|
| C4 | `LoadLink`/`preloadOutcome` заранее читают форму 3.x; ошибка загрузчика в 2.x неотличима от успеха (kit#12399) — ограничение задокументировано | `preloadData` → `{ type: 'error', status, error }`: ветка уже написана, 2.x-ветка в R-тесте и комментарии удаляются |
| F5 | пагинатор читает адрес через адаптер, а не через `page.url` | `page.shallow?.url ?? page.url` — реактивный видимый адрес |
| F6 | шторка: `pushState(location.href, …)`, потому что `''` теряет `#якорь` | **не подтверждено**: `goto(null, …)` в типах 3.0.1 нет (`goto(url: string \| URL, …)`). Спайк: теряет ли `goto('', { shallow, state })` якорь |
| F37 | **не исправлено**: href `ModalTrigger` из нереактивного `window.location` | href из видимого адреса |
| F38 | **не исправлено**: ядро модалок слышит только `popstate` | хуки навигации срабатывают и на shallow → источник уведомления для ядра |
| — | `cores/sveltekit.ts` `location()`: `window.location` в браузере, `page.url` на сервере | один источник (спайк) |
| — | `cores/sveltekit.ts` `readState()`: `history.state` вместо `page.state` после «Назад» + отсрочка на микрозадачу | kit#16449 закрывает kit#13293 — возможно, обход не нужен (спайк, не обещаю) |

---

## 4. Предусловия

| Требование 3.x | У нас | Действие |
|---|---|---|
| Node ≥ 22.17 | песочница **v20.20.2**; `engines` не задан | Node 22.17+ (лучше 24: см. ловушку npm) в песочнице и деплое; `engines.node` |
| TypeScript ^6 (7 не поддерживается) | ^6.0.3 | закрепить `~6`/`^6`, не поднимать до 7 |
| Svelte ≥ 5.57.1 | установлен 5.57.1, диапазон `^5.56.1` | диапазон `^5.57.1` (sv migrate ставит `^5.56.4` — ниже peer, byteiota) |
| Vite ≥ 8.0.12, vite-plugin-svelte ≥ 7 | 8.3.1, ^7.1.2 | — |
| адаптеры | `adapter-auto` ^7 → **8.0.0** (peer `^3.0.0-next.0`); `adapter-vercel` ^6 → 7.0.0 | `adapter-vercel` в коде не используется — вопрос §10 |
| Kit 3 + адаптер 8 + Vite 8 поднимаются **вместе**, иначе ERESOLVE | отчёты dependabot/renovate | один коммит фазы B |
| svelte-check читает конфиг из `vite.config` | с 4.6.0 (у нас ^4.6.0, latest 4.7.6); peer TS `^5 \|\| ^6` | поднять до 4.7.x вместе с фазой A2 |
| прочие зависимости | `@ark-ui/svelte` peer `svelte >=5.20`; vitest 4 (5.0.3 — peer `vite ^8`); unocss 66 — от Kit не зависят | не блокируют; vitest 5 — отдельно, не в этом переезде |
| lock-файл | в репозитории **два**: `package-lock.json` и `bun.lock` | решить, какой менеджер главный (§10); после фазы B lock перегенерировать (haruspex #341) |

---

## 5. Принцип «без остатков v2»

После переезда удаляется:
1. **устаревшее API**, даже если оно ещё работает в 3.x:
   - `$app/environment`, `$env/*`;
   - `json`/`text`;
   - `pushState`/`replaceState`;
   - `invalidateAll`;
   - `goto({ replaceState })`;
   - опция `alias`;
   - форма `export const snapshot`;
   - типизация `PageData` вместо `PageProps`;
2. **файлы совместимости**:
   - `svelte.config.js`;
   - `extends ./.svelte-kit/tsconfig.json`;
   - флаг `experimental.explicitEnvironmentVariables` (в 3.0.1 его нет — переменные стабильны);
3. **обходы ограничений 2.x**:
   - ветки «на случай 2.x» в коде и тестах;
   - `history.state`/`window.location`, если спайк покажет, что они больше не нужны;
4. **упоминания 2.x** в комментариях кода и в живой документации (README, docs/design). Исторические записи
   аудита (`docs/audit/ratings.md`, `crutches.md`) — это журнал решений: строки не переписываются, а
   получают пометку «закрыто переходом на 3.x, коммит …»;
5. **следы миграции**: `@migration-task`, `MIGRATION_TASKS.md`.

**Что НЕ является мусором** (остаётся сознательно; по каждому пункту — причина):
- нативные `history.pushState`/`popstate` в ядрах **без** SvelteKit (`modals/cores/browser`, `fastedge`, `router/*` вне
  `sveltekit.ts`): это не API Kit, а платформа;
- `envReader` из `lib/db/sveltekit/node`: публичный API `lib/db` для не-Kit окружений (README:94, `process.env`).
  Приложение (`server/db.ts`) перестаёт им пользоваться, если `$app/env/private` даёт именованные значения
  (решение на шаге A3, после чтения `lib/db` в аудите);
- `import.meta.env.DEV/SSR` (13 строк в `src`, без тестов) — это Vite, не Kit; решение C7 (`esm-env` в библиотеках) не меняется;
- `process.env` в `src/lib/db/probes` и тестовых скриптах (26 строк) — Node-скрипты, не код приложения; ещё 3 — примеры не-Kit использования в `lib/db/README.md` и `docs/TRANSPORTS.md`.

### Сверка по типам: что доступно на 2.70.3, а что только на 3.x

| Замена | 2.70.3 | 3.0.1 | Фаза |
|---|---|---|---|
| конфиг в `sveltekit({...})` | есть (с 2.62) | обязательно | A |
| `$app/env` (`browser`, `dev`, `building`, `version`) | есть | есть | A |
| `src/env.ts` + `defineEnvVars` + `$app/env/private` | есть, флаг `experimental.explicitEnvironmentVariables` | стабильно, **флага нет** | A (флаг снимается в B) |
| `Response.json(...)` вместо `json(...)` | платформа | `json` устарел | A |
| `refreshAll` | есть | есть (`invalidateAll` устарел) | у нас 0 вызовов |
| `PageProps` вместо `PageData` | есть (с 2.16) | есть | A |
| `#lib` (subpath imports) | Vite и TS понимают сами; `$lib` Kit 2 продолжает работать | `$lib` не генерируется | A (спайк) или B |
| типы хуков из `@sveltejs/kit/hooks` | **нет**: модуль есть, но `Handle` в нём не экспортирован | только там (`@sveltejs/kit` их больше не отдаёт) | **B** |
| `goto({ shallow, replace, reset, state })` | **нет** (только `replaceState`/`noScroll`/`keepFocus`) | есть; `keepFocus`/`noScroll` **удалены** (в 3.0.1 их нет в типах — ошибка компиляции) | **B** |
| `preloadData` → `type: 'error'` | нет | есть | **B** |
| `extends: "$app/tsconfig"` | нет | обязательно | **B** |

---

## 6. Инвентаризация (счёт по git-дереву на `e8311d2`)

| Изменение | Где у нас | Объём | Фаза |
|---|---|---|---|
| `svelte.config.js` → `sveltekit({ adapter, csrf: { trustedOrigins }, preprocess })` в `vite.config.ts` | файл + `tooling/env-docs.mjs:23` + комментарии (`.env.example:8,28`, `form-security.ts:9`, `test/browser/db-demo-browser.check.mjs:14`, `lib/db/docs/CHECKLIST-2.md:328,336`) | 1 файл удалить, 6 мест поправить | A2 |
| логика `trustedOrigins` **дублируется** в `svelte.config.js` и `server/form-security.ts` (env + порты превью). После переезда в TS-конфиг её можно взять из одного чистого модуля | 2 копии | вопрос §10 | A2 |
| `$app/environment` → `$app/env` | `modals/cores/sveltekit.ts:12`, `modals/svelte/media.svelte.ts:3`, `router/sveltekit.ts:17`; комментарий `ui/js-only.svelte.ts:7` | 3 импорта + 1 комментарий | A1 |
| `$env/dynamic/private` → `src/env.ts` + `$app/env/private` | `server/db.ts:19`, `server/form-security.ts:16`. Переменные: `KIT_TRUSTED_ORIGINS`, `PREVIEW_PORTS`, `E2B_SANDBOX_ID`, `DATABASE_URL`, `HYPERDRIVE_CONNECTION_STRING`, `DATABASE_DIR`, `DB_POOL_MAX`, `DB_CONNECT_TIMEOUT_MS`, `DB_CURSOR_SECRET`, `DB_CURSOR_OLD_KEYS`, `DB_CURSOR_TTL_SECONDS`, `VERCEL` | 2 файла + новый `src/env.ts` (12 переменных, все dynamic, private) | A3 |
| `tooling/env-docs.mjs`: страж `.env.example` разбирает чтения env регулярками | после A3 список переменных — `src/env.ts`. Варианты: страж сверяет `.env.example` с `src/env.ts`, либо заменяется | вопрос §10 | A3 |
| `json(...)` → `Response.json(...)` | 5 `+server.ts` | 5 файлов | A4 |
| `PageData` → `PageProps` | `routes/paginator/+page.svelte:2,6`, `routes/cards/[id]/+page.svelte:4`, `routes/db-demo/+page.svelte:18,33`; комментарий `app.d.ts:17` | 3 файла | A5 |
| `App.PageState` не объявлен (открытый пункт аудита) | `app.d.ts` | нужен для `goto(..., { state })` | A5 |
| `$lib` → `#lib` + расширения | **528 импортов в 163 файлах**, из них:<br>• 226 — импорт каталога (→ `…/index.js`);<br>• 96 — без расширения;<br>• 32 — `.svelte`.<br>Кроме того:<br>• 32 упоминания в `.md`;<br>• **гарды** `tooling/layer-guard`, `core-purity`, `source-schema-guard`, `db-docs` и их тесты разбирают строку `$lib`;<br>• `tsconfig.json:4` `rewriteRelativeImportExtensions` (haruspex #341: убрать) | самый большой дифф; стиль — вопрос §10 | A6 (спайк на 2.x) или B |
| типы хуков → `@sveltejs/kit/hooks` | `hooks.server.ts:9`, `lib/db/README.md:131` (`lib/db/sveltekit/context.ts` намеренно структурный — не трогать) | 2 места | B |
| `tsconfig.json` → `extends: "$app/tsconfig"` + явные `include`/`exclude` (Kit 3 их не генерирует, tellegen #156) | сейчас `extends ./.svelte-kit/tsconfig.json`, свои `exclude` (C9, C10) | 1 файл | B |
| `pushState`/`replaceState` из `$app/navigation` → `goto(url, { shallow: true[, replace: true], state })` | `modals/cores/sveltekit.ts:13,64-65`, `router/sveltekit.ts:18`, `ui/demo/spike/SpikeDemo.svelte:3` | 3 файла | B |
| опции `goto`: `replaceState` → `replace`; `noScroll`/`keepFocus` → `reset: false` | `router/sveltekit.ts:129-131`, `router/LoadLink.svelte:93`, `SpikeDemo.svelte` | 3 файла (ошибка компиляции на 3.0.1) | B |
| фикстура `$app/stores` (модуль удалён) | `tooling/source-schema-guard.test.mjs:94` | 1 тест | B |
| `tooling/size-budget.mjs` читает внутренние пути `.svelte-kit/output/client` и `.svelte-kit/generated/client-optimized/app.js` | 2 пути | в документации Kit не описаны → проверить после сборки на 3.x | B |

**Поведенческое (автоматически не мигрирует, нужна проверка):**

| Изменение 3.x | Где у нас | Риск / действие |
|---|---|---|
| `preloadData` отдаёт `type: 'error'` | `router/sveltekit.ts:201` готов (C4). **`modals/cores/sveltekit.ts:122-133`** считает всё, что не `loaded`, переадресацией | **баг при переходе**: ошибка загрузчика route-модалки станет «redirect». Ветка `error` + юнит-тест, красный без правки |
| `goto` отклоняет адрес, не ведущий на маршрут | `LoadLink.svelte:93`, демо «Битая ссылка» `/no-such-page/1` | обработать отклонение по документации; обновить R-тест |
| хуки навигации срабатывают на shallow. Назад к shallow-записи — тоже `shallow: true` ([cli#1392] п. 4) | `router/sveltekit.ts:116` `afterNavigate` (флаг `ready`) | фильтр `navigation.type === 'goto' && navigation.shallow`, а не просто `shallow` — иначе ломается восстановление состояния по «Назад» |
| `refreshAll` **не** сбрасывает `page.state`, в отличие от `invalidateAll` | у нас нет вызовов | учесть в спайке F6/`readState` |
| ссылка на текущую страницу → `refreshAll()` | `SidebarNav`, `NavSlot` (активный пункт) | проверить, что пагинатор не теряет состояние |
| ошибки рендера идут в `handleError` и ближайший `+error.svelte` | `/cycle`, `/spike`, `test/browser/errors.mjs` | ожидания тестов могут поменяться |
| `server.ts` в имени → server-only **в любом каталоге** (в 2.x — только `lib/server/`, `*.server.*`) | новое: `lib/form/server.ts`. Его импортируют только серверные модули (`ui/demo/form/handle.ts`, `ui/demo/db-form/handle.ts` ← маршруты `+page.server.ts`/`+server.ts`) | проверено сканом: клиентских импортёров нет; защита от утечки — плюс |
| cookie v2: имена только ASCII, путь по умолчанию `/` | B11 (cookie каркаса) | проверить имя и путь |
| `page.url` неизменяем | мутаций `page.url` нет (скан) | — |
| 204 без тела; внешний `redirect` требует `{ external: true }` | 204 и внешних redirect в маршрутах нет (скан) | — |
| enhanced form actions | `use:enhance` в приложении нет; свой транспорт `lib/form` | проверить db-demo и forms в браузере |
| бюджеты размера | allJs 209.2/214, immutable 222.6/223.3, `/modals` 149.8/150 | превышение → +5 KiB по правилу владельца, с отчётом |

---

## 7. Фазы

Каждый шаг — отдельный коммит после `gate.sh` (GATE OK). Где меняется поведение — плюс браузерные наборы:
- на 4173: `regressions`, `modals`, `shell`, `paginate`, `capabilities`, `errors`, `forms-a11y`;
- на 5174: `forms`, `db-demo`.

Не пушится.

### Фаза A — на 2.70.3, в master (обратимо, мажор не меняется)

- **A1.** `$app/environment` → `$app/env` (3 импорта + комментарий).
- **A2.** Конфиг:
  - `svelte.config.js` → `sveltekit({...})` в `vite.config.ts`, файл **удалить**;
  - поправить `tooling/env-docs.mjs` и все упоминания (§6);
  - svelte-check поднять до 4.7.x и убедиться, что он читает конфиг из Vite (0 ошибок / 0 предупреждений, как сейчас);
  - дубль `trustedOrigins` — по решению §10.
- **A3.** Env:
  - `src/env.ts` (`defineEnvVars`, 12 переменных; валидация — функции без новой зависимости или уже
    имеющийся `zod`; помнить ловушку `?? ''` из [cli#1392] п. 8);
  - `experimental.explicitEnvironmentVariables: true`;
  - `$env/dynamic/private` → `$app/env/private` в двух файлах;
  - запись C7 в `crutches.md` обновить;
  - `env-docs` — по решению §10.
- **A4.** `json` → `Response.json` (5 файлов).
- **A5.** `PageData` → `PageProps` (3 файла), объявить `App.PageState`.
- **A6 (спайк, затем решение).** `#lib` на 2.70.3:
  - добавить `imports` в `package.json`;
  - перевести **один** модуль;
  - проверить `svelte-check`, vitest, `build`, dev.

  Если всё зелёное — полный перевод в фазе A **своим кодмодом**: он меняет только спецификатор импорта и
  байт-в-байт не трогает остальной файл. Плюс гарды и их тесты. Если спайк красный — шаг уходит в B2.
- **A7.** `engines.node` и Node в песочнице/деплое (может стоять до B из-за окружения).

### Фаза B — смена мажора (ветка `upgrade/kit3`)

- **B0.** `sv migrate sveltekit-3 --tasks all` на **одноразовой копии** (`git worktree` в `/tmp`). Его
  `MIGRATION_TASKS.md` и дифф — только чек-лист для сверки: не пропустили ли мы что-то. В рабочую ветку
  ничего не переносим целиком.
- **B1.** Одним коммитом поднять `@sveltejs/kit` ^3.0.x, `adapter-auto` ^8, `svelte` ^5.57.1 (+ решение
  по `adapter-vercel`). Удалить флаг `experimental.explicitEnvironmentVariables`. Перегенерировать lock.
- **B2.** `#lib`, если не сделан в A6.
- **B3.** `tsconfig.json`:
  - `extends: "$app/tsconfig"`;
  - явные `include` (`src`, `test`, `tooling`, `vite.config.ts` — как генерировал Kit 2) и `exclude`;
  - сохранить исключения C9/C10;
  - убрать `rewriteRelativeImportExtensions`.
- **B4.** Типы хуков → `@sveltejs/kit/hooks` (2 места).
- **B5.** Shallow-запись:
  - `pushState`/`replaceState` → `goto(url, { shallow: true[, replace: true], state })` в трёх файлах;
  - опции `goto` (`replace`, `reset: false`);
  - фильтр хуков `navigation.type === 'goto' && navigation.shallow`.
- **B6.** `modals/cores/sveltekit.ts` `preload`: ветка `type: 'error'` + юнит-тест (красный без правки).
- **B7.** `LoadLink`: отклонённый `goto` для «битой» ссылки.
- **B8.** Фикстура `$app/stores` в тесте гарда.
- **B9.** `size-budget.mjs`: пути вывода сборки 3.x.
- **B10.** Поведенческие проверки из §6, затем гейт + все 9 браузерных наборов.

### Фаза C — снятие обходов (ради этого переезд)

- **C1.** ✅ (модалки — фаза B; роутер пагинатора — ход 17, решение A) Спайк (как `SPIKE-HISTORY.md`):
  - `page.shallow?.url ?? page.url` и `page.state` после «Назад»/«Вперёд» при shallow-записях модалок;
  - сохраняется ли `#якорь` у `goto('', { shallow })`.

  Итог спайка — таблица «обход нужен / не нужен» с доказательством.
- **C2.** ✅ (фаза B, Q0=a; строка 19 §8 = 0) Удалить то, что спайк признал ненужным:
  - `window.location` в `location()`;
  - `history.state` и отсрочку на микрозадачу в `readState()`;
  - собственный `popstate` в `modals/cores/sveltekit.ts`.
- **C3. F38** ✅ (ход 17, R-37): ядро модалок получает уведомление о навигации из адаптера SvelteKit, контракт `ModalCore` не
  меняется. Проба `nav_chain_probe.py`, случай B → цепочка пуста.
- **C4. F37** ✅ (ход 17, R-36): href `ModalTrigger` от реактивного видимого адреса (`location()` по решению (a)). Проба `trigger_href_probe.py`.
- **C5.** F5/F6: упростить адаптер роутера и шторку, если спайк подтвердит. Регрессии F5/F6 остаются зелёными.
  ✅ (ход 17): F5 — search из `page.shallow?.url ?? page.url`, свой `popstate`/`createSubscriber`/уведомления
  удалены; якорь — из адресной строки в момент записи (решение A, R-38: из `page.*` он терялся после клика по
  ссылке-якорю). F6 — `goto('')` в 3.0.1 по-прежнему теряет якорь (`resolve_url`), адрес шторки остаётся
  адресной строкой. Очередь F12 оставлена: без неё 10/10 зелёных, но лишь из-за тайминга микрозадач Kit,
  а `navigation_before_start` объявлен.
- **C6.** Ветки 2.x ✅ (ход 17):
  - `router/sveltekit.ts:181-198` (комментарий «Kit 2.x…», расширенный тип);
  - `LoadLink.svelte:27-28`;
  - `test/browser/regressions.mjs:1203-1257` (ветка 2.x C4 удаляется, остаётся только проверка 3.x);
  - `routes/modals/+page.svelte:131`.
- **C7.** Документация ✅ (ход 17):
  - `crutches.md` (C4, C7, F37, F38 — пометка «закрыто переходом, коммит …»);
  - `framework-imports.md` (раздел «Замечание на будущее: `$app/environment` → `$app/env`» удалить как выполненный);
  - `docs/audit/README.md:31` (версии проекта);
  - `lib/db` README/PORTING — упоминания «Kit 2» привести к 3.x.

### Фаза D — приёмка

- гейт;
- 9 браузерных наборов;
- пробы F37/F38;
- `svelte-check` 0/0;
- бюджеты;
- ручной обход сайта в dev и preview без ошибок и предупреждений в консоли (требование хода 2);
- **нулевой список §8 = 0 по всем строкам**;
- в выводе dev/build нет предупреждений о deprecated.

После этого — аудит `lib/db` (47 файлов) и `lib/ui` (142 файла) уже на 3.x.

---

## 8. Нулевой список (после фазы D каждая строка = 0)

Команды выполняются из корня, исключения: `package-lock.json`, `bun.lock`, этот файл, исторические журналы аудита.
«Сейчас» — счёт на `e8311d2`, вхождений / файлов.

| # | Что | Шаблон (`git grep -nE`) | Где искать | Сейчас |
|---|---|---|---|---|
| 1 | файл конфига v2 | `test -e svelte.config.js` | корень | есть |
| 2 | упоминания `svelte.config` | `svelte\.config` | всё дерево | 10 / 8 |
| 3 | `$lib` | `\$lib\b` | `src test tooling *.ts *.js *.json` + живые `.md` | 528 / 163 в коде; в `.md` — 136 строк в 18 файлах: живые доки (README модулей, `lib/db/docs`, `docs/design`, корневые отчёты) переводятся, журналы аудита получают пометку |
| 4 | `$app/environment` | `\$app/environment` | код + живые доки | 4 в коде (+9 в доках аудита) |
| 5 | `$env/*` | `\$env/` | код + живые доки | 4 в коде (+9 в доках аудита) |
| 6 | флаг 2.x env | `explicitEnvironmentVariables` | `vite.config.ts` | 0 (появится в A3, снимается в B1) |
| 7 | `json`/`text` из kit | `import \{[^}]*\b(json\|text)\b[^}]*\} from '@sveltejs/kit'` | код | 5 / 5 |
| 8 | shallow-API v2 | `import \{[^}]*\b(pushState\|replaceState)\b[^}]*\} from '\$app/navigation'` | код | 3 / 3 |
| 9 | опции `goto` v2 | `\b(keepFocus\|noScroll)\b`, `goto\([^)]*replaceState:` | код | 4 / 2 + 2 |
| 10 | `invalidateAll` | `invalidateAll` | код | 0 |
| 11 | типы хуков из корня kit | `import (type )?\{[^}]*\b(Handle\|HandleServerError\|HandleClientError\|HandleFetch\|Reroute)\b[^}]*\} from '@sveltejs/kit'` | код + README | 2 (`hooks.server.ts`, `lib/db/README.md`) |
| 12 | `PageData`/`LayoutData`/`ActionData` | `\b(PageData\|LayoutData\|ActionData)\b` | `src` | 6 / 4 |
| 13 | tsconfig v2 | `\.svelte-kit/tsconfig`, `rewriteRelativeImportExtensions` | `tsconfig.json` + доки | 1 + 3 |
| 14 | `$app/stores` | `\$app/stores` | код/тесты | 1 (фикстура) |
| 15 | следы `sv migrate` | `@migration-task\|MIGRATION_TASKS` | всё | 0 (контроль) |
| 16 | ветки и комментарии «2.x» | `\b2\.x\b\|[Kk]it 2\b\|SvelteKit 2\b\|12399` | `src test tooling` + живые доки | 16 / 9 |
| 17 | Svelte 4 legacy (контроль) | `svelte/legacy\|^\s*export let \|\bon:[a-z]+=\|<slot[ />]\|createEventDispatcher\|svelte:component` | `src` | 0 |
| 18 | устаревшие опции конфига (контроль) | `preloadStrategy\|checkOrigin\|node/polyfills\|data-sveltekit-[a-z-]+="off"` | конфиг/код | 0 в коде (1 цитата исходника Kit в `CHECKLIST-2.md:335` — пометить как историю) |
| 19 | обходы 2.x в адаптере модалок | `history\.state`, `window\.location`, `popstate` | `src/lib/modals/cores/sveltekit.ts` | по итогам спайка C1: 0 или обоснованный остаток, записанный в `crutches.md` |
| 20 | второй lock-файл | `ls bun.lock package-lock.json` | корень | 2 файла → 1 (решение §10) |

Итог хода 17 (`~/.agent/probes/zero-list.sh`): все строки 0, кроме принятых остатков:
- строка 12 — `// interface PageData {}` в `src/app.d.ts`: шаблон Kit 3, `App.PageData` в 3.0.1 есть
  (`types/index.d.ts:4000`), это не остаток v2;
- строка 18 — одна цитата исходника Kit в `CHECKLIST-2.md:335`, помечена как история (так и планировалось);
- строка 20 — один lock-файл (цель).

Строка 19 — единственная, где допустим «обоснованный остаток»: если спайк докажет, что 3.x всё ещё
требует обхода. Тогда это не остаток v2, а новая запись в `crutches.md` с причиной и ссылкой.

---

## 9. Ловушки из обсуждения и наша подверженность

| Ловушка | Источник | У нас |
|---|---|---|
| перепечатка `.svelte` меняет текст: `</a>,` → перенос + пробел, `&lt;b&gt;` → тег, `&nbsp;`/`&larr;` раскодируются | [cli#1392] п. 3 (открыт) | `PaginatorDemo.svelte:55` `&lt;опция&gt;`; 26 мест `</тег>` + пунктуация в 71 `.svelte` с `$lib` → `sv migrate` на рабочем дереве **не запускаем** |
| shallow-routing вставляет `if (navigation.shallow) return` во все хуки — ломает «Назад» | [cli#1392] п. 4 (исправлено в sv 1.1.1) | правим руками: `type === 'goto' && shallow` |
| `#lib` без расширения не резолвится (Vite видит каталог) | haruspex #337 | 226 импортов каталогов → явный `…/index.js` или отдельные алиасы (§10) |
| `"#lib": "./src/lib/index.js"` при `index.ts` | [cli#1392] п. 5 (not fixing) | у нас `src/lib/index.ts` — писать `imports` руками |
| тесты/гарды, разбирающие импорты, должны понимать `#lib` | haruspex #341 | 4 гарда + тесты |
| схемы env `?? ''` ломают `A ?? B` | [cli#1392] п. 8 | `PREVIEW_PORTS ?? '5173,5174'`, `DB_POOL_MAX ?? …` — значение по умолчанию держать в коде либо в схеме, но не пустой строкой |
| `ORIGIN` в `.env` не замечен проверкой | [cli#1369] | adapter-node не используем — нет |
| npm с Node 22 падает на свежей установке | byteiota | ставить Node 24 или проверить npm |
| CI/деплой ссылается на `svelte.config.js` | byteiota, kit#17393 (Vercel) | `env-docs`; Vercel — если деплой там (вопрос §10) |
| `svelte-kit sync` генерирует типы дважды | kit#17394 (PR открыт) | безвредно; проверить время `check` |

---

## 10. Вопросы владельцу (до старта фазы A)

**Ответы владельца (2026-10-11, ход 16):**

| # | Решение |
|---|---|
| 1 | `#lib` в стиле документации: полный путь с расширением `.js` (`#lib/form/index.js`, `#lib/ui/Button.svelte`), одно правило `"#lib/*": "./src/lib/*"`, без алиасов на модули |
| 2 | один чистый модуль `src/lib/server/trusted-origins.ts` для `vite.config.ts` (`process.env`) и серверного слоя (`$app/env/private`) |
| 3 | страж `tooling/env-docs.mjs` удалить: перечень, описания и проверки — `src/env.ts` |
| 4, 5 | `package-lock.json` главный, `bun.lock` удалить; `@sveltejs/adapter-vercel` удалить; `vercel.json`/`wrangler.jsonc` не трогать |
| 6 | не спрашивалось: `adapter-auto` остаётся, Node в песочнице — 24 |
| 7 | сразу |
| 8 | всё в ветке `upgrade/kit3`; master не трогается до завершения переезда |
| — | install-скрипт esbuild одобрить (`allowScripts`) |

**Ход фазы A (ветка `upgrade/kit3`):** A1 `58ae1c9` · A2+A3 `4958b0e` · скрипты `node --test` на Node ≥ 21 `48786e4` ·
A4 `5b4f93c` · A5 `a9f7b0f` · A6 `0aad223` · чистка §10 `ab3957a`. После A — гейт и все 9 браузерных наборов зелёные.

Исходные вопросы:


1. **Стиль `#lib`.** По документации — `#lib/form/index.js` (226 таких импортов) и `#lib/x.js` для файлов.
   Альтернатива: отдельные алиасы на публичные точки модулей (`#modals`, `#form`, `#paginate`…) в
   `package.json#imports` — короче, и граница модуля видна в импорте. Это архитектурное решение (меняет вид
   импортов и правила гардов). Расширение в спецификаторе: `.js` (по документации) или `.ts`.
2. **Дубль `trustedOrigins`** (`svelte.config.js` ↔ `form-security.ts`): вынести в один чистый модуль, который
   читают и `vite.config.ts`, и серверный слой — или оставить две копии, как сейчас.
3. **`env-docs`** после `src/env.ts`: страж сверяет `.env.example` с `src/env.ts` (один источник) — или страж
   удаляется как лишний.
4. **`adapter-vercel`** (в коде не используется): удалить или поднять до 7. Связанные файлы: `vercel.json`, `wrangler.jsonc`.
5. **Менеджер пакетов**: в репозитории `package-lock.json` и `bun.lock`. Какой главный, второй удалить.
6. **Где деплой и какой Node** — чтобы `engines`, окружение и kit#17393 (Vercel) были учтены.
7. **Сроки**: фаза A сразу; фаза B — по условиям §2.3 (или своя дата).
8. Фазу A вливать в master по шагам (предложение) или держать в ветке вместе с B.

---

## 11. Откат

- Фаза A совместима с 2.x: каждый шаг откатывается `git revert` своего коммита.
- Фазы B–C живут в ветке `upgrade/kit3` до приёмки; master остаётся на 2.70.3 (+ фаза A).

## 12. Замечено попутно, вне переезда (не делаю без решения)

Мусор в корне, не связанный с v2 → v3 (все файлы в git):
- ~~`uno.config.ts` и `unocss.config.ts` — почти одинаковые~~ — активен `unocss.config.ts` (проверено сборкой), `uno.config.ts` удалён (ход 16, решение владельца Q5);
- `CHECKLIST.md`, `CLICK_THROUGH_CHECKLIST.md`, `PAGINATOR_CHECKLIST.md`, `UNIVERSAL_DEMO_PANEL_*.md`;
- `spike-history.py`, `browser-check.mjs`, `delete-check.mjs`;
- 6 `.png` в корне и `screenshots/` (24 файла).

Часть из них упоминается в доках `lib/db` и `ModalHost.svelte`. Предлагаю разобрать отдельным заходом.

Найдено во время фазы A (ход 16):
- `npm audit`: `seroval`/`solid-js` — critical, `source-map-js` — high; исправления в пределах мажора (`fix: true`),
  к переезду не относятся. Kit/cookie (low) закрываются фазой B;
- `npm run test:browser` гоняет все наборы подряд, а серверы им нужны разные: `regressions`/`modals`/… ждут preview
  на :4173, `forms`/`forms-a11y`/`db-demo` — на :5173. Одним сервером скрипт не проходит;
- `src/lib/links/index.ts:2` — комментарий ссылается на несуществующий модуль `links/panel`;
- холодный `vite dev` в песочнице (2 GB) упирается в OOM на `/db-demo` и на master — свойство среды, не кода.

Найдено во время фазы B (ход 16):
- **Гонка обхода истории в ядре модалок (R-24)** — давняя, Kit 3 её расширил: операция между `go()` и
  применением обхода считала шаги от устаревшей глубины (`go(-2)` → `about:blank`). Исправлено в `build.ts`
  (решение Q3=a), три юнит-теста красные без правки.
- **`tooling/size-budget.mjs`**: (1) путь `generated/client-optimized` — раскладка 2.x; гейты ветки читали
  устаревший app.js сборки 2.x, пока его не вычистил `vite dev` 3.x; (2) узлы `~n` (серверные данные)
  выбрасывались → `/paginator` всегда мерился без страницы. Исправлено (B9); лимит `/paginator` 196.5 (Q4).
- **Вес `/paginator`**: 191.5 KiB gzip начальной загрузки (страница + её чанки) — кандидат на разбор.
- **«Весь JS» 213.9 / 214.0 KiB** — запас 0.1.
- **Порядок CSS-переменных темы UnoCSS недетерминирован** между сборками: побайтное сравнение CSS
  некорректно, сравнивать по набору правил/объявлений.
- **UnoCSS `transformIndexHtml`** — предупреждение Kit 3 `transform_index_html_unsupported`; хук мёртвый
  (kit#8269). Снят в `vite.config.ts` (Q1=a); убрать снятие, когда решат в UnoCSS или Kit (kit#17373).
- **`src/app.html` никогда не сканировался UnoCSS** (и на 2.x; unocss#1774): 10 утилит `<html>` (`scroll-smooth`,
  курсор кнопок, выделение…) не попадали в CSS. Исправлено `content.filesystem` (Q2).
- **`probes/`** (78 файлов, 15 читали ключ 2.x `sveltekit:states`) удалён (Q5); живые проверки перенесены:
  `test/http/db-demo-http.check.mjs` (35), `test/browser/db-demo-browser.check.mjs` (17),
  `test/browser/url-storage.check.mjs` (19) — зелёные на 3.x; курсорный режим требует `DB_CURSOR_SECRET`
  (без него 501 — штатно). `classes-audit.mjs`, `uno-probe.mjs` → `tooling/`.

Найдено во время фазы C (ход 17):
- **`page.shallow` не обновляется при клике по ссылке-якорю** (SvelteKit 3.0.1, `update_url` трогает только
  `page.url`): видимый адрес `page.shallow?.url ?? page.url` после этого несёт старый `#якорь`. Обход — якорь
  из адресной строки в момент записи (решение A); кандидат на issue в Kit.
- **SSR-href триггеров модалок** — подозрение не подтвердилось: до гидратации триггеры без маршрута — `<button>`.
- **736 относительных импортов без расширения** в `src/lib` — законны в 3.x (`$app/tsconfig`:
  `moduleResolution: bundler`, `allowImportingTsExtensions`); к переезду не относятся.
- **Флаки проба `select_option`**: первый прогон пробы на холодном preview получил «option not enabled» 30 с;
  повтор зелёный. Не воспроизвелось.

Статус фазы B (ход 16): B0–B9 выполнены, коммит `d5d681a`. Попутно в фазе B сделано то, что планировалось
в C1 для модалок: движок без `window.location`/`history.state` (решение Q0=a). Остаётся C1 для роутера
пагинатора (`router/sveltekit.ts`: `window.location` + `popstate`) и пункты C2–C6, F37/F38, §8.

Статус фаз C и D (ход 17): C1–C7 выполнены (`1a7bb1c`, `2528260`). Приёмка D:
- гейт OK (svelte-check 0/0, tooling 105, vitest 725/725, бюджеты);
- 9/9 браузерных наборов (regressions 65 с R-36…R-38);
- пробы F37/F38 зелёные на финальной сборке;
- обход 40 страниц на preview и 40 на dev — ошибок и предупреждений в консоли нет, кроме намеренных
  демо-404 («Битая ссылка», «Загрузчик с ошибкой»); в выводе build и dev нет предупреждений deprecated;
- **не выполнено:** `/db-demo` в `vite dev` — процесс убивает OOM песочницы (2 GB) ещё при компиляции,
  как и на master; на preview страница чистая, набор db-demo зелёный;
- нулевой список §8: 0 везде, кроме принятых остатков строк 12, 18, 20 (см. §8).


## 13. После переезда — очередь работ

### 13.1. Shikimori целиком через GraphQL (задача владельца, ход 19)

**Замысел** (владелец): весь источник Shikimori ходит через GraphQL-транспорт `#lib/server/graphql.ts`.
Транспорт — ОБЩИЙ (GraphQL — стандарт, эндпоинтов много): он не знает про Shikimori, Shikimori для него —
адрес и документы запросов. Перевод не должен вносить в `graphql.ts` знание о Shikimori.
**Факт** на `d6f01be`: через GraphQL идут только жанры v2 и выборка частот схемы фильтров
(`shikimori-schema.ts`). Через REST (`shikimori.ts`) — каталог `/animes` (список, поиск, фильтры,
страницы), студии `/studios`, допустимые значения kind/status/rating/duration (разбор текста ответа 422),
край годов, словарь коррекции поиска.

Последствия расхождения:
- два транспорта, у каждого свой кэш, зазор между запросами, повтор и таймаут; зазор `MIN_GAP_MS` не общий —
  вместе они обращаются к Shikimori чаще заявленного;
- кэш `graphql.ts` без предела размера: перевод каталога (ключ из ввода пользователя) без потолка вернёт F10;
- `upstreamFailure` (живёт в `shikimori.ts`) не знает `GraphqlUpstreamError`: сбой GraphQL уходит в лог как
  сбой нашего сервера, клиенту — «внутренняя ошибка сервера» вместо текста о недоступном внешнем сервисе.
  Ход 21: `message`/`cause` у `GraphqlUpstreamError` разделены (как B8). Варианты распознавания:
  (a) нейтральный `#lib/server/upstream.ts` — базовый `UpstreamError(message, status, {cause})` и
  `upstreamFailure`; Shikimori- и GraphQL-ошибки наследуют его; транспорт GraphQL от Shikimori не зависит;
  (b) `upstreamFailure` в `shikimori.ts` дополнительно проверяет `GraphqlUpstreamError` — помощник роутов
  остаётся «шикимориным», любой другой GraphQL-потребитель тянет `shikimori.ts`;
  (c) распознавать любой `Error` с числовым `status` — ловит чужие ошибки (например, `HttpError` Kit).
  **Лучший — (a)**: единственный, где общий транспорт и общий помощник не знают о конкретном API.

Разобраться — по шагам, решения владельца перед кодом:
1. Спайк без правок: интроспекция схемы GraphQL Shikimori и сверка с REST на тех же запросах — предел
   `limit`, `search`, `order`, каждый фильтр (`genre`, `studio`, `kind`, `status`, `rating`, `duration`,
   `score`, `season`), форма ошибок; есть ли в GraphQL студии и перечисления (вместо разбора 422).
2. Объём перевода (вопрос владельцу): только каталог / всё, что умеет GraphQL / только GraphQL.
3. Один транспорт: общий кэш с потолком, общий зазор, повтор, таймаут, классы ошибок для `upstreamFailure`.
4. Удалить REST-код, ставший ненужным (принцип «без остатков»), обновить тесты, регрессии shikimori,
   `crutches.md` (B8, F10) и этот план.

### 13.2. Причина закрытия floating при снятии записи (`ModalHost.svelte:548-558`)

Эффект закрывает floating (Select/меню в листе), чья запись исчезла из цепочки, всегда с причиной `'escape'`.
Запись исчезает в двух разных ситуациях:
1. закрылась модалка-владелец (её хвост снят вместе с записью листа) — триггер floating уходит вместе с ней;
2. владелец жив, снята только запись листа — «Назад»/«Вперёд» или запись ядра извне.

Причина — не только подпись: по `'escape'` Select и `FloatingMenu` возвращают фокус на триггер, по
`'programmatic'`/`'transfer'` — ничего не делают. `'owner-closed'` в типе `HostFloatingCloseReason` объявлен,
но хост его не отправляет нигде.

Варианты:
- (a) ситуация 1 → `'owner-closed'` (уже в типе, API не меняется); ситуация 2 → новая причина `'history'`
  (добавление в публичный тип), потребители возвращают фокус на `'escape' | 'history'`;
- (b) обе → `'owner-closed'`: API не меняется, но в ситуации 2 фокус больше не возвращается (откат a11y);
- (c) оставить `'escape'`: поведение верное, подпись ложная, потребитель ситуации не различает.
**Лучший — (a)**; требует решения владельца (дополнение публичного типа).
**Сделано (ход 22, решение владельца — лучший вариант):** `HostFloatingCloseReason` + `'history'`; хост запоминает
запись под листом и шлёт `owner-closed`/`history`; Select и `FloatingMenu` возвращают фокус на `escape | history`.
Проба на старом и новом коде: видимое поведение фокуса в обеих ситуациях совпадает (в ситуации 1 фокус всё равно
возвращала модалка) — правка исправляет причину, которую получают потребители. R-39 закрепляет фокус (не может быть
красной на старом коде; защищает от варианта (b)).

### 13.3. F8: предупреждение `ssr_fetch_eager` «от чужой страницы» в dev

Механизм (SvelteKit 3.0.1, `runtime/server/page/render.js:226-253`): в dev на всё время асинхронного SSR-рендера
Kit подменяет ГЛОБАЛЬНЫЙ `fetch` предупреждающей обёрткой. Наш транспорт ставит запросы в очередь с паузой
(`schedule`, вежливость к API), поэтому запрос, рождённый `load` страницы A, уходит позже — когда идёт рендер
страницы B, и Kit предупреждает от имени B (стек хода 21: `shikimori.ts:368` ← `schedule`).
Попутно: обёртки перекрывающихся рендеров вкладываются друг в друга (в стеке две `render.js:240` подряд), а
восстанавливаются не в обратном порядке — после рендеров глобальный `fetch` может остаться обёрткой. Только dev.

`event.fetch` не помогает: внешний запрос Kit делает голым `fetch` (`server/fetch.js:79,117,126`).

Проверенные варианты (10 залпов параллельных запросов в dev, одинаковая нагрузка):
- без изменений — 5 предупреждений;
- (a) настоящий `fetch` берётся один раз в хуке `init` (`hooks.server.ts`, выполняется до любого рендера;
  обёртки рендера там нет — проверено) и передаётся транспортам — **0 предупреждений**;
- (b) взять `globalThis.fetch` при загрузке модуля транспорта — ненадёжно: модуль грузится лениво, в том числе
  во время чужого рендера, и навсегда запомнит обёртку (рассуждение, не проба);
- (c) issue в Kit: предупреждать, только если запрос принадлежит рендерящемуся запросу (у Kit уже есть
  `AsyncLocalStorage`-хранилище запроса, `try_get_request_store()`), плюс порядок восстановления обёрток.
**Лучший — (a)** на нашей стороне (естественно ложится в общий транспорт §13.1) и (c) как сообщение в Kit.
Решение владельца по F8 — «на изучение»: без слова не внедряю.
**Сделано (ход 22, решение владельца — лучший вариант):** `#lib/server/upstream.ts` (`captureUpstreamFetch` в `init`,
`upstreamFetch()` в транспортах REST и GraphQL); `lib/db/adapters/proxy.ts` не тронут — у него своя явная передача
`fetch` через конфиг (аудит `lib/db` впереди). Сообщение в Kit (c) не отправлялось.

