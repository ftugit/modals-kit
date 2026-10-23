# Единый мастер-план и живой чек-лист рефакторинга `modals-kit` (`Этапы S1 → S6`: от безопасных окраин к фундаменту)

Самодостаточная спецификация и сквозной чек-лист выполнения [`ui-consistency.md`](./ui-consistency.md) + архитектурной перестройки слоёв, самодостаточных форм `#hooks/component-form`, папочных UI-модулей `src/components/{fields,paginator}/`, изоляции витрин `src/content/demo-catalog/` и единого реестра маршрутов `#lib/address`.

> **Регламент работы между чатами (ЗАФИКСИРОВАН ВЛАДЕЛЬЦЕМ):**
> 1. **От безопасного к фундаментальному:** все работы выстроены строго в 6 этапов **`S1` → `S6`** — сначала полностью изолированные правки UI-примитивов и чистое добавление модулей (`S1–S4`), затем единый атомарный переезд верхних папок и конфигов (`S5`), и сразу за ним — **единый полный прогон всех тестов и браузерных сьютов** (`S6`).
> 2. **Без холостых прогонов тяжёлых тестов на промежуточных этапах (`S1–S4`):** на простых этапах проверяем только мгновенный синтаксис/аудит классов, отмечаем `- [ ]` → `- [x]` в этом файле и в [`./ui-consistency.md`](./ui-consistency.md), коммитим и пушим в `origin/img`, выдаём отчёт по этапу и ждём приказа продолжить (а также предупреждаем заранее, если контекст чата подходит к порогу сжатия).
> 3. **Самодостаточность при нулевом контексте:** вся информация об окружении, секретах сборки, ловушках стражей и точных сигнатурах собрана ниже прямо в этом документе — перечитывать весь репозиторий в новом чате не нужно.

---

## 0. Памятка автономного исполнения с холодного старта (Environment, Gates & Traps)

- **Рабочее дерево:** `/home/user/projects/modals-kit`, ветка **`img`**, удалённая ветка **`origin/img`** (**`main` никогда не трогать!**).
- **Архив сессии:** `/home/user/agent-state` (`CONTINUATION_CHECKLIST.md`, `patches/`).
- **Холодный старт контейнера (если `node_modules` пуст):**
  ```bash
  export PATH="/usr/local/bin:$PATH"
  bash /home/user/agent-state/setup-env.sh
  bash /home/user/agent-state/ensure-playwright.sh
  ```
- **Критичные переменные окружения (на Этапах `S5–S6` при сборке и тестах):**
  - `export PLAYWRIGHT_BROWSERS_PATH="/var/cache/pw-browsers"` (`/tmp` — это `tmpfs` в 2 GiB RAM без swap!).
  - `AUTH_SEAL_SECRET="0123456789abcdef0123456789abcdef"` и `KIT_TRUSTED_ORIGINS="http://127.0.0.1:5173"` **обязательны и во время `npm run build`, и во время `npx vite preview`** (`$env/static/private` инлайнится на этапе `vite build`, без него авторизация выключена).
  - Никогда не вызывать `pkill -f` внутри `bash -c` — искать точный PID через `ss -tulpn` и гасить `kill <PID>`.
  - Пуш в GitHub без утечки токена:
    ```bash
    TOKEN=$(cat /home/user/uploads/github-token-modals-kit.txt | tr -d '[:space:]')
    git -c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" push origin img
    ```
- **5 жёстких технических ограничений репозитория:**
  1. **`0` байт в `src/lib/form/**`** (`tooling/form-size.mjs` держит строгий потолок веса — все расширения `onSuccess`, `not-applied`, `import.meta.glob` кладутся в `src/hooks/component-form/`).
  2. **`0` правок кода в `src/lib/db/**`**, а все 14 обратных кавычек с путями `` `src/...` `` в `src/lib/db/{README.md,PORTING.md,docs/*.md}` обновляются синхронно с переездом файлов на Этапе **`S5`** (`tooling/db-docs.mjs:341` проверяет `exists()` каждого пути!).
  3. **В `src/content/user/vault.ts` и `vault.svelte.ts`** — только динамический `await import(...)` транспорта формы в `postRenew` (статический импорт ломает бюджет начальной загрузки в `tooling/size-budget.mjs`).
  4. **`trusted-origins.ts`** импортируется напрямую в `vite.config.ts:7` до старта плагинов SvelteKit — в нём **запрещены** `$app/*` и `$env/*`.
  5. **Стенды ядер `/form/submit/+server.ts` и `/db-demo/submit/+server.ts` не удалять и не переделывать** — они тестируют опрос очереди `pollUntilDone` и NDJSON-стриминг `taskResponse(..., { watch: [watchDb] })`.

---

## 1. Утверждённые решения владельца (все вопросы закрыты)

1. **5 верхних слоёв и subpath-алиасов в `package.json`:**
   - `#lib/*` → `./src/lib/*` (`address`, `cache`, `db`, `fetch`, `form`, `image`, `modals`, `paginate`, `task` — **вместе со своими фреймворковыми адаптерами** `svelte/`, `sveltekit/`, `cores/sveltekit.ts`, `node.ts`).
   - `#hooks/*` → `./src/hooks/*` (`app-errors.svelte.ts`, `cache-db.ts`, `db-form.ts`, `graphql.ts`, `js-only.svelte.ts`, `task-stream.server.ts`, `use-drawer.svelte.ts`, `links/`, `component-form/`).
   - `#components/*` → `./src/components/*` (`utils.ts`, `ErrorPage.svelte`, `Error500.svelte`, `ui/`, `settings/`, `demo/`, `form/`, `fields/`, `paginator/`, `modals/`, `steps/`, `loader/`, `shell/`).
   - `#content/*` → `./src/content/*`:
     - **`src/content/user/`** — боевой доменный модуль пользователя (`index.ts`, `routes.ts`, `modals.ts`, `*.server.ts`, `ui/*`);
     - **`src/content/demo-catalog/`** — изолированная папка **всех** демо-источников витрин вместе с демо-БД (`items/`, `posts/`, `rickmorty/`, `shikimori/`), чтобы не создавать инверсий `#server → routes`, не плодить кросс-импорты между роутами (`0` исключений в `layer-guard.mjs`) и удалять весь учебный контент одной командой `rm -rf src/content/demo-catalog`.
   - `#server/*` → `./src/server/*` (`db.server.ts`, `schema-admin.server.ts`, `cache.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `form-security.server.ts`, `after-response.server.ts`, `api-error.server.ts`, `trusted-origins.ts`).
2. **Все 4 визуальных решения по `ui-consistency.md` утверждены:**
   - **`U3`:** единый `Skeleton` в `ui/skeleton/Skeleton.svelte` (`animate-pulse rounded-md bg-muted`), `paginator` и `modals` — тонкие обёртки.
   - **`U9 / F3 / F4`:** глобальный `aria: { invalid: 'invalid="true"' }` в `unocss.config.ts` + красная рамка на всех невалидных контролах, включая триггер `Select`, ячейки `OtpInput`, `Checkbox` и `Switch`.
   - **`U4`:** `PasswordStrength` на семантических переменных темы (`--warning` / `--success`).
   - **`F6`:** полноценные нативные примитивы `RadioGroup` и `Range` в `ui/` строго по стилям `shadcn` v4 (рецепты записаны в [`./ui-consistency.md §2`](./ui-consistency.md)).
3. **Максимальное переиспользование готовых механизмов (0 изобретённых велосипедов):**
   - `address/routes.ts` (~60 строк) строится на **уже установленном `@standard-schema/spec`** + готовых `localPath` (`#lib/address/core.ts`) и `nextSearch` (`#lib/address/keys.ts`); `kitRoute` в `address/sveltekit.ts` типизируется встроенными `RouteId` / `RouteParams<Path>` из `$app/types`; связка с модалками идёт через штатный `registerModal({ route: userAuthRoute.href })` (`0` связности между `#lib/modals` и `#lib/address`).

---

## 2. Единая поэтапная дорожная карта и живой чек-лист (`S1` → `S6`)

---

### Этап S1. Изолированные листья `ui/`, глобальный `aria-invalid` в UnoCSS и чистка мёртвого кода — **[ВЫПОЛНЕНО]**
*(Нулевой риск: затрагиваются только внутренние файлы `ui/`, `TextareaField` и тема `unocss.config.ts`, внешние контракты не меняются.)*
- [x] **S1.1 (`U9` + `U3a`).** `unocss.config.ts` + `tooling/classes-audit.mjs`: добавлен `aria: { invalid: 'invalid="true"' }` в `UNO_THEME`, удалены 3 мёртвых шортката (`nav-pill`, `nav-pill-active`, `skeleton`), снята слепая зона на `aria-*:` и `data-*:` вариантах в `classes-audit.mjs` (`Маркер-классов: 0`, `Все утилиты сгенерированы`).
- [x] **S1.2 (`U6`).** Создан `src/lib/components/ui/close-icon/CloseIcon.svelte`, заменены все 4 инлайновых крестика (`SearchField.svelte`, `SelectList.svelte` ×2, `FileAttachment.svelte`).
- [x] **S1.3 (`U1` + `U5`).** В `src/lib/components/ui/field/field.ts` экспортированы `fieldBase` и `affixButtonClass`; `Textarea`, `AutoTextarea`, `SearchInput`, `SelectList` переведены на `fieldBase`; `PasswordInput`, `CopyInput`, `SearchField`, `NumberField` — на `affixButtonClass`.
- [x] **S1.4 (`U2/F2` + `U4` + `F7`).** Удалён мёртвый `const cls` в `form/TextareaField.svelte`; цвета `PasswordStrength.svelte` переведены на `--warning` / `--success`; удалён мёртвый `ui/search/SearchMorph.svelte` и убран `NativeSelect` из публичного барреля `ui/index.ts`.

---

### Этап S2. Полное закрытие `ui-consistency.md`: невалидность составных полей, `FieldShell`, `Skeleton`, `class`/`wrapperClass`, `RadioGroup` + `Range` (`shadcn` v4) — **[ВЫПОЛНЕНО]**
*(Низкий риск: вся работа локализована внутри UI-примитивов и обёрток `form/`.)*
- [x] **S2.1 (`F3 / F4` + `Checkbox`/`Switch`).** Проброшены `data-invalid` и подсветка `border-destructive` / `ring-destructive/20` на видимый триггер `Select.svelte`, слоты `OtpInput.svelte`, `Checkbox.svelte` и `Switch.svelte`.
- [x] **S2.2 (`U7` + `F6`).** Вынесен `controlBase` в `field.ts`; созданы примитивы `ui/radio-group/{RadioItem,RadioGroup}.svelte` и `ui/range/Range.svelte` по эталонам `shadcn` v4 из [`ui-consistency.md §2`](./ui-consistency.md); radio-ветка `Attachment.svelte` переведена на `<RadioItem />`; созданы `form/RadioGroupField.svelte`, переведены на `<Range>` `form/RangeField.svelte` и `form/RatingField.svelte`, обновлён `form/resolve.ts`.
- [x] **S2.3 (`F1` + `F9` + `F8`).** Добавлен `labelPlacement?: 'top' | 'end'` в `form/FieldShell.svelte`, `CheckboxField` / `SwitchField` переведены на `FieldShell`; написан контрактный тест `form/resolve.test.ts`; проверены статичные группы полей на `/form` и `/modals` (`<Fieldset>`).
- [x] **S2.4 (`F5` + `U3b`).** Унифицирован закон `class` (на контрол) / `wrapperClass` (на внешнюю обёртку) в `PasswordInput`, `CopyInput`, `PhoneInput`, `SearchInput`, `OtpInput` (обновлён вызов в `paginator/SearchBar.svelte`); `paginator/Skeleton.svelte` и `modals/Skeleton.svelte` переведены в тонкие обёртки над `ui/skeleton/Skeleton.svelte`.

---

### Этап S3. Чистое аддитивное расширение `#lib/address` (`routes.ts` + `sveltekit.ts`) — **[ВЫПОЛНЕНО]**
*(Нулевой риск поломки: чистое добавление нового модуля внутри `src/lib/address/` без затрагивания старого кода.)*
- [x] **S3.1.** Реализован `src/lib/address/routes.ts` (`registerRoute` / `defineRoute`, `localPathSchema`, `querySchema` с `href`, `parse`, `patch` поверх `@standard-schema/spec`, усиленного `localPath` из `./core.ts` и `claimQuery`/`nextSearch` из `./keys.ts`) и реэкспортирован из `src/lib/address/index.ts`.
- [x] **S3.2.** Добавлен `kitRoute` в `src/lib/address/sveltekit.ts` с compile-time проверкой `Path` / `RouteId` / `RouteParams<Id>` из `$app/types` и сборкой динамических сегментов через `resolve()` из `$app/paths`.
- [x] **S3.3.** Написаны unit-тесты `src/lib/address/routes.test.ts` (дефолты, валидация `StandardSchemaV1` / Zod v4, откат на дефолты при битых query, отсечение Open Redirect `//evil.com`, `/\evil.com`, `javascript:`, сохранение чужих query-параметров в `patch()`, защита от дублей в реестре).

---

### Этап S4. `#hooks/component-form` v2 + самодостаточные модули `fields/` и `paginator/` — **[СЛЕДУЮЩИЙ ЭТАП]**
*(Средний уровень: сборка папочных модулей и перевод `/fields` и `/paginator` до глобального переезда импортов.)*
- [ ] **S4.1.** Доработать `src/hooks/component-form/` (`description(event)`, `source`, авто-inline `200` при `outcome === 'not-applied'`, `onSuccess` в `bind.svelte.ts`, автосбор `*.form.server.ts` через `import.meta.glob`) — `0` байт в `src/lib/form/`.
- [ ] **S4.2.** Собрать папочный модуль `fields/` (`SchemaBuilder.svelte` со скрытым submit для `Enter` без JS, `SchemaFields.svelte`, `SchemaValues.svelte`, `variants.ts`, `types.ts`, `index.ts`), перевести на него `/fields` (5 тонких файлов) и удалить `/fields/{save,record}/+server.ts` + обновить `test/browser/fields.mjs:230,244`.
- [ ] **S4.3.** Собрать папочный модуль `paginator/` (`Paginator.svelte`, перенос `SearchBar.svelte` и `filters/*` в `paginator/ui/`, `variants.ts`, `types.ts`, `index.ts`) и перевести на него `GalleryDemo.svelte` и `CatalogDemo.svelte`.

---

### Этап S5. Фундаментальный переезд слоёв, `demo-catalog/`, `user/{routes,modals}` и стражей
*(Главный сквозной этап — выполняется одним атомарным переездом всего дерева.)*
- [ ] **S5.1.** Добавить `#components/*` и `#server/*` в `package.json`; перенести `src/lib/components/*` + `utils.ts` + `Error*.svelte` → `src/components/*` (`header`+`sidebar` внутрь `shell/`, `nav.ts` → `src/routes/(site)/nav.ts`, `cn` в `DemoPanel.svelte`), связки (`js-only`, `use-drawer`, `links/`, `app-errors`, `graphql`, `task-stream.server.ts`) → `src/hooks/*`, синглтоны → `src/server/*.server.ts` (`trusted-origins.ts` без `$app/*`); удалить `src/lib/{components,hooks,server}/`.
- [ ] **S5.2.** Собрать все демо-источники и демо-БД в **`src/content/demo-catalog/{items,posts,rickmorty,shikimori}/`** и перевести на `#content/demo-catalog/...` `src/server/db.server.ts`, `src/routes/api/*`, `/db-demo` и `/paginator`.
- [ ] **S5.3.** Оформить `src/content/user/{routes.ts,modals.ts}`, переименовать серверные файлы `user/` в `*.server.ts`, проставить дефолтные пропы в `ProfileForm`/`AuthWidget` и перевести все ссылки `/user/auth` и `/user/menu` по проекту на `userAuthRoute` / `userMenuRoute`.
- [ ] **S5.4.** Синхронно обновить `vite.config.ts`, `unocss.config.ts`, `tooling/layer-guard.mjs` (+ `.test.mjs`, все 5 алиасов в `canonSpecifier` + правило `*.server.ts`), `tooling/classes-audit.mjs`, `tooling/source-schema-guard.mjs` (+ `.test.mjs`), 14 путей в markdown-доках `src/lib/db/**` и `test/browser/attachment.mjs`.

---

### Этап S6. Полное сквозное тестирование всего объёма (`S1`–`S5`), бюджеты и документация
*(Финальная приёмка сразу после фундаментального Этапа `S5`.)*
- [ ] **S6.1.** Прогнать полный контур статических и unit-проверок: `npm run test:guard`, `npm run test:classes`, `npm run check`, `npx vitest run`, `npm run build && node tooling/size-budget.mjs`.
- [ ] **S6.2.** Прогнать все браузерные Playwright-сьюты (`auth.mjs`, `modals.mjs`, `shell.mjs`, `forms.mjs`, `forms-a11y.mjs`, `fields.mjs`, `attachment.mjs`, `steps.mjs`, `paginate.mjs`, `shikimori.mjs`, `db-demo.mjs`) и устранить любые найденные регрессии.
- [ ] **S6.3.** Записать правила UI-слоя в `src/components/ui/README.md` (**`U8`**), актуализировать `AGENTS.md`, `docs/audit/{README,testing-backlog}.md` и подтянуть потолки `tooling/size-budget.mjs`.
