# План: переход на SvelteKit 3

Статус: **план, не начат** (решение владельца, ход 13: «делай план под этот случай, сейчас оставь как есть»).
Сейчас: `@sveltejs/kit` 2.70.3 (последняя 2.x), Svelte 5.57.1, Vite 8.3.1, TS ^6.0.3, vite-plugin-svelte ^7.1.2.
Цель: `@sveltejs/kit` 3.0.1 (npm `latest` на 2026-10-11).

Источники: [руководство по миграции](https://svelte.dev/docs/kit/migrating-to-sveltekit-3),
[shallow routing в 3.x](https://svelte.dev/docs/kit/shallow-routing),
[kit#16449](https://github.com/sveltejs/kit/pull/16449) (shallow через `goto`, `page.shallow`, хуки навигации),
[kit#12579](https://github.com/sveltejs/kit/pull/12579) (`preloadData` → `type: 'error'`).

## 1. Зачем: что 3.x решает проще

Одна причина у большинства случаев: в 2.x «мелкая» запись адреса (`pushState`/`replaceState` из
`$app/navigation`) не меняет `page.url`, не вызывает хуки навигации, а у `preloadData` нет исхода «ошибка».
Проект обходит это вручную. В 3.x у фреймворка есть штатный путь.

| Находка | Ход | Как обходим в 2.x | Что даёт 3.x |
|---|---|---|---|
| C4 | 4–6 | `LoadLink`/`preloadOutcome` читают форму 3.x заранее; ошибка загрузчика в 2.x неотличима от успеха (kit#12399), ограничение задокументировано | `preloadData` → `{ type: 'error', status, error }`: ветка уже написана, заработает без правок |
| F5 | 5 | пагинатор читает адрес через адаптер, а не `page.url` (тот не меняется при shallow-записи) | `page.shallow?.url ?? page.url` — реактивный видимый адрес |
| F6 | 5 | шторка: `pushState(location.href, …)`, потому что `''` теряет `#якорь` | **не подтверждено**: в описании kit#16449 есть `goto(null, { state })`, но в типах 3.0.1 `goto(url: string \| URL, …)` — `null` нет. Проверить спайком, теряет ли `goto('', { shallow, state })` якорь в 3.x; иначе обход остаётся |
| F37 | 13 | **не исправлено**: href `ModalTrigger` из нереактивного `window.location` | href из `page.shallow?.url ?? page.url` |
| F38 | 13 | **не исправлено**: ядро модалок слышит только `popstate`, переход по ссылке внутри одной области не перечитывает цепочку | хуки навигации срабатывают и на shallow; видимый адрес реактивен → источник уведомления для ядра |
| — | инвентаризация | `cores/sveltekit.ts` `location()`: `window.location` в браузере, `page.url` на сервере (SSR) | один источник `page.shallow?.url ?? page.url` (**проверить спайком**) |
| — | инвентаризация | `cores/sveltekit.ts` `readState()`: `history.state` вместо устаревающего после «Назад» `page.state` + отсрочка уведомления на микрозадачу | kit#16449 закрывает kit#13293 «history.state ↔ page.state» — возможно, обход не нужен (**проверить спайком**, не обещаю) |

Отложено до перехода (решение владельца, ход 13): **F37, F38**. До перехода — как есть.

## 2. Предусловия и блокеры

| Требование 3.x | У нас | Действие |
|---|---|---|
| Node ≥ 22.17 | песочница: **v20.20.2**; `engines` в `package.json` не задан | поставить Node 22 в окружение (и там, где деплой), добавить `engines` |
| TypeScript ≥ 6 | ^6.0.3 | — |
| Svelte ≥ 5.57.1 | установлен 5.57.1, но диапазон `^5.56.1` | поднять диапазон |
| Vite ≥ 8.0.12 | ^8.0.16 (8.3.1) | — |
| vite-plugin-svelte ≥ 7 | ^7.1.2 | — |
| адаптеры под 3.x | `adapter-auto` ^7 → 8.0.0; `adapter-vercel` ^6 → 7.0.0 | `adapter-vercel` в коде не используется — **вопрос владельцу**: убрать или поднять |

## 3. Инвентаризация: что затронет (счёт по `src`, `test`, `tooling`, конфигам)

**Механическое (`npx sv migrate sveltekit-3` делает бо́льшую часть):**

| Изменение | Где у нас | Объём |
|---|---|---|
| `svelte.config.js` не поддерживается → опции в `sveltekit({...})` в `vite.config.ts` | `svelte.config.js` (adapter, `csrf.trustedOrigins` из `KIT_TRUSTED_ORIGINS` + превью-порты), `tooling/env-docs.mjs` (`SCANNED_FILES`), упоминания в `form-security.ts`, `lib/db/docs/CHECKLIST-2.md` | 1 конфиг + 3 места |
| `$lib` → `#lib` + расширения файлов (`#lib/foo.ts`), `imports` в `package.json` | 162 файла / 528 импортов; **плюс гарды** `tooling/layer-guard.mjs`, `core-purity.mjs`, `source-schema-guard.mjs`, `db-docs.mjs` и их тесты разбирают строку `$lib` | самый большой дифф |
| `tsconfig.json` extends `$app/tsconfig` + явные `include`/`exclude` | `extends: ./.svelte-kit/tsconfig.json`, свои `exclude` (C9, C10) | 1 файл, сохранить исключения |
| `$app/environment` → `$app/env` | `modals/svelte/media.svelte.ts:3`, `modals/cores/sveltekit.ts:12`, `router/sveltekit.ts:17` (+ комментарий `ui/js-only.svelte.ts:7`) | 3 импорта; `$app/env` **есть уже в 2.70.3** — можно до перехода |
| `pushState`/`replaceState` устарели → `goto(url, { shallow: true[, replace: true] })` | `modals/cores/sveltekit.ts:13,64-65`, `router/sveltekit.ts:18`, `ui/demo/spike/SpikeDemo.svelte:3` | 3 файла (не удалены — предупреждения) |
| опции `goto`: `replaceState` → `replace`, `noScroll`+`keepFocus` → `reset: false` | `router/sveltekit.ts:129-131`, `router/LoadLink.svelte:93`, `SpikeDemo.svelte:73` | 3 файла |
| `$env/dynamic/private` устарел → `$app/env/private` | `server/db.ts:19`, `server/form-security.ts:16` | 2 файла (C7: решение «одна форма» сохраняется) |
| `json(...)` устарел → `Response.json(...)` | 5 `+server.ts` | 5 файлов |
| типы хуков → `@sveltejs/kit/hooks` | `hooks.server.ts:9`, `lib/db/README.md:131` | 2 места |
| `tooling/source-schema-guard.test.mjs:94` — фикстура с `$app/stores` (модуль удалён) | 1 тест | фикстура, не код |

**Поведенческое (нужна проверка, автоматически не мигрирует):**

| Изменение 3.x | Где у нас | Риск |
|---|---|---|
| `preloadData` отдаёт `type: 'error'` | `router/sveltekit.ts:201` — готов (C4). **`modals/cores/sveltekit.ts:122-133`** — всё, что не `loaded`, считает `redirect` | **баг при переходе**: ошибка загрузчика route-модалки станет «переадресацией». Добавить ветку `error` (тот же класс, что C4) |
| `goto` отклоняет адрес, не ведущий на маршрут | `LoadLink.svelte:93` — демо «Битая ссылка» `/no-such-page/1` | промис отклонится вместо перехода на 404 → обработать (`window.location` по документации) и обновить R-тест |
| хуки навигации срабатывают на shallow | `router/sveltekit.ts:116` `afterNavigate` — флаг `ready`, повторы игнорирует | низкий; проверить, что записи модалок/пагинатора не будят чужие хуки |
| ссылка на текущую страницу → `refreshAll()` | меню (`SidebarNav`, `NavSlot`): клик по активному пункту | перезагрузка данных на клик по активному пункту — проверить, не сбрасывает ли состояние пагинатора |
| ошибки рендера идут в `handleError` и ближайшую границу `+error.svelte` | `/cycle`, `/spike`, `test/browser/errors.mjs` | ожидания тестов ошибок могут поменяться |
| ответы enhanced form action со статусом `fail(...)` | `lib/db`-демо (`fail` в 20 файлах); собственный транспорт `lib/form` | проверить db-demo и forms в браузере |
| серверные модули по сегменту имени: **`server.ts`** — теперь server-only | `lib/form/server.ts` (импортируют только серверные модули) | плюс: защита от импорта в клиент; убедиться, что клиент его не тянет |
| `cookie` v2: имена только ASCII, путь по умолчанию `/` | B11 (cookie каркаса, `+layout.server.ts`) | проверить имя и путь cookie |
| `paths.origin` вместо `ORIGIN`; CSRF всегда включён | `csrf.trustedOrigins` — переезжает в плагин как есть | низкий |
| `version.pollInterval` = 1 ч по умолчанию | — | без последствий |
| бюджеты размера | allJs 209.2/214, immutable 222.6/223.3, `/modals` 149.8/150 | превышение → +5 KiB по правилу владельца, с отчётом |

## 4. Этапы

Ветка `upgrade/kit3`, не пушится. Каждый этап — отдельный коммит после `gate.sh` (GATE OK) и, где
меняется поведение, браузерных наборов (`regressions`, `modals`, `shell`, `paginate`, `capabilities`,
`errors`, `forms-a11y` на 4173; `forms`, `db-demo` на 5174).

**Этап 0 — подготовка на 2.70.3 (без смены мажора, обратимо, можно влить в master):**
1. `$app/environment` → `$app/env` (3 импорта; модуль есть в 2.70.3).
2. Конфиг из `svelte.config.js` в `sveltekit({...})` в `vite.config.ts` (поддерживается с 2.62) + `tooling/env-docs.mjs`.
3. `json(...)` → `Response.json(...)` (5 файлов).
4. Проверено по типам 2.70.3: модуль `@sveltejs/kit/hooks` есть, но тип `Handle` он сам берёт из `@sveltejs/kit` — экспорт `Handle` проверить; у `goto` в 2.70.3 только `replaceState`/`noScroll`/`keepFocus` (`replace`/`reset` — только 3.x, этап 2). `$app/env/private` — генерируемый модуль, проверить по `.svelte-kit/ambient.d.ts` после `sync`.
5. Объявить `App.PageState` (открытый пункт аудита) — нужно и для `goto(..., { state })`.

**Этап 1 — окружение:** Node ≥ 22.17 в песочнице и в деплое, `engines.node` в `package.json`.

**Этап 2 — смена мажора (ветка):**
1. Поднять `@sveltejs/kit` ^3.0.1, `svelte` ^5.57.1, `adapter-auto` ^8 (+ решение по `adapter-vercel`).
2. `npx sv migrate sveltekit-3`; дифф прочитать целиком, без слепого принятия.
3. `$lib` → `#lib`: импорты + `package.json#imports` + **правила гардов и их тесты** (layer-guard, core-purity, source-schema-guard, db-docs).
4. `tsconfig.json` → `$app/tsconfig`, сохранить исключения C9/C10.
5. Устаревшее → новое: `pushState/replaceState` → `goto({ shallow })`, опции `goto`, `$env` → `$app/env/private`, типы хуков.
6. Гейт + все браузерные наборы зелёные.

**Этап 3 — поведенческие правки:**
1. `modals/cores/sveltekit.ts` `preload`: ветка `type: 'error'` + юнит-тест (красный без правки).
2. `LoadLink`: отклонённый `goto` для «битой» ссылки; R-тест C4 (`regressions.mjs:1203-1257`) сам переключится на ветку kit 3 — проверить, что она зелёная.
3. Проверки из таблицы «поведенческое»: refresh по активной ссылке, ошибки рендера, `fail`-статусы, cookie.

**Этап 4 — снятие обходов, ради которых переход:**
1. Спайк (как `SPIKE-HISTORY.md`): `page.shallow?.url ?? page.url` и `page.state` после «Назад»/«Вперёд» при shallow-записях модалок — нужны ли ещё `window.location`, `history.state` и отсрочка на микрозадачу.
2. **F38**: ядро модалок получает уведомление о навигации из адаптера SvelteKit (видимый адрес/хуки), контракт `ModalCore` не меняется. Проба `nav_chain_probe.py` случай B → цепочка пуста.
3. **F37**: href `ModalTrigger` от реактивного видимого адреса. Проба `trigger_href_probe.py`.
4. F5 (и F6 — только если спайк покажет, что якорь не теряется): упростить адаптер роутера и шторку, если спайк подтвердит (поведение не меняется — регрессии F5/F6 остаются зелёными).
5. Документация: убрать «ограничение 2.x» из C4 (`LoadLink.svelte:28-30`, `router/sveltekit.ts:181-198`, `routes/modals/+page.svelte:131`), обновить `crutches.md`, `framework-imports.md`.

**Этап 5 — приёмка:** гейт, 9 браузерных наборов, пробы F37/F38, `svelte-check` 0/0, бюджеты, ручной
обход сайта в dev и preview без ошибок и предупреждений в консоли (требование хода 2).

## 5. Вопросы владельцу перед стартом

1. Когда начинать (после аудита оставшихся 203 файлов или раньше).
2. `adapter-vercel`: удалить (не используется) или поднять до 7.
3. Где задаётся Node в деплое — чтобы `engines` и окружение совпали.
4. Этап 0 вливать в master сразу (он обратим и не меняет мажор) или держать в ветке вместе с переходом.

## 6. Откат

Этапы 2–4 живут в ветке до приёмки; master остаётся на 2.70.3. Этап 0 совместим с 2.x — откатывается
обычным `git revert` по коммиту.
