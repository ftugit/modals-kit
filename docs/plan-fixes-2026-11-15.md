# План исправлений: аудит 13–15.11 и вскрытие шапки из ActiveFilters

Дата: 2026-11-15. База: `img` / `3563ee8`. Статус: P0 (placeholder в `FilterBlock`), P1 (публичная проекция профилей, контракт revoke) и P2 (кнопка снятия группы, selection key, размер страницы, route registry, UTC-дата, проверка `logoutLocal`) реализованы. Добавлены тесты placeholder-а, проекции профилей, смешения форм revoke, размера страницы и ключа выбора. Не сделаны отдельные пункты: браузерный тест `UserConfig`/`frame` и полный `test:browser` (в песочнице недоступен); `test:size` остаётся красным, бюджеты не поднимались. Проверка шапки выполнена в локальном dev-браузере на desktop и mobile.

## 0. Что подтверждено, а что нет

Из аудита другого ИИ:

| Находка | Вердикт |
|---|---|
| `Listing.frame` нужно рендерить через `{@render}` | **Не подтверждено.** `frame` — callback `(parts) => unknown`, а не snippet. `UserConfig` сохраняет snippets и возвращает `null`; SSR-тест `UserConfig.ssr.test.ts` проходит (6/6). Менять на render-tag нельзя. |
| Публичный список профилей отдаёт полный `ProfileView` | **Подтверждено.** План §2.5 требует публичную проекцию; сейчас уходят `id` и `updatedAt`, а `authId` нужен для навигации. |
| `RevokeBulkArgs` допускает смешение `ids` и среза | **Подтверждено.** `kind: 'slice'` с непустыми `ids` уходит в срез; `session-delete.form.server.ts` при наличии slice-полей игнорирует `ids`. |
| Нет domain-тестов на revoke по `ids` | **Подтверждено.** В `sessions.server.test.ts` все вызовы `revokeBulkSessions` идут через `where`. |
| `ActiveFilters` не даёт снять конкретное значение при наличии popup-блока | **Частично.** Это следствие варианта `fields`: метка открывает блок, снятие — в popup. Нужно решение UX и тесты, а не слепое возвращение старых чипов. |
| `SeedUsersList`/`BlocksList` не сбрасывают выбор при смене фильтров | **Подтверждено.** `SessionsList` уже учитывает фильтры и размер порции. |
| `logoutLocal()` игнорируется | **Не текущий дефект.** `logoutLocal()` всегда возвращает `{ ok: true }` после снятия кук. Латентный контрактный запах. |
| `profiles.size` принимает значения вне `[30, 50, 100]` | **Подтверждено.** Сервер принимает `31`, клиентский адаптер отбрасывает и возвращается к 30. |
| `git diff --check` | **Подтверждено.** Пустые строки в EOF и trailing whitespace в `test/browser/select-floating-smoke.mjs`. |
| Большой sync-коммит | **Подтверждено**, процессный риск. |

Дополнительно найдено:

- `ProfilesList`/`profiles/source.ts` хардкодят `/profiles` вместо `profilesListRoute.href()`.
- `ProfilesList` форматирует дату через `toLocaleDateString('ru-RU')` без фиксированной таймзоны — риск SSR/CSR mismatch.
- `UserConfig` пишет `sessionsParts = parts` из `frame`-callback во время рендера. SSR это не ловит; нужен браузерный тест, прежде чем менять.

---

## P0. Шапка вскрывается при клике по ActiveFilters

### Воспроизведение (Playwright, desktop 1280×900, текущий Vercel preview)

1. Открыть `/paginator?page.src=animes-rest&page.filters.genres.and=11`.
2. Раскрыть `details` «Выбрать фильтры» — монтируются `FilterBlock`-и.
3. Прокрутить `main` вниз: `main.scrollTop = 2152`, шапка `data-progress="1.000"`, высота `68.8px` (верхний ряд скрыт).
4. Нажать на метку ActiveFilters «Жанры · все из Игры».

Факт после нажатия:

- `main.scrollTop` падает `2152 → 2048` (вверх на 104 px);
- `main.scrollHeight` падает `4581 → 4429` (−152 px);
- шапка `data-progress` меняется `1.000 → 0.000`, высота `68.8 → 116.8px` — верхний ряд вскрывается.

### Причина

`FilterBlock.svelte` при открытии popup переносит **сам узел блока** из формы в слот всплывашки:

```ts
slot.appendChild(root)
```

Блок «Жанры» стоит в форме **выше** метки ActiveFilters. При переносе узел исчезает из потока, высота формы уменьшается на высоту блока. Браузерный scroll anchoring компенсирует сдвиг, уменьшая `main.scrollTop`. `CollapsingHeader` слушает `main` и трактует любое уменьшение `scrollTop` как жест «скролл вверх», поэтому съедает дельту и раскрывает верхний ряд.

`Select` так себя не ведёт, потому что его popup не вынимает из потока блок над якорем и не меняет высоту страницы. Проблема не в том, что `ActiveFilters` использует модальную систему; проблема в переносе узла без резервирования места.

### Исправление

Рекомендуемый вариант — **не менять высоту домашней формы при переносе**:

1. В `FilterBlock.svelte` перед `slot.appendChild(root)` создать дома placeholder:
   - `span` без `name` и без интерактивных детей;
   - `display: block`, ширина 100%, высота равна `root.getBoundingClientRect().height`;
   - `aria-hidden="true"`, `data-filter-block-placeholder`.
2. Вставлять placeholder в `homeEl` вместо `root` на время открытия.
3. При возврате (`cleanup`) вернуть `root` на место и удалить placeholder.
4. Обновлять высоту placeholder через `ResizeObserver`/`MutationObserver`, если блок меняет высоту (ошибки, перенос строк).
5. Проверить `display: contents` у родительских span: placeholder должен занимать реальную высоту, поэтому ему нужен собственный `display:block`.

Дополнительно, как страховка:

- в `CollapsingHeader` добавить подавление scroll-событий, вызванных не пользовательским жестом: флаг `hold`/`data-fe-header-hold` на время открытия floating/sheet, либо игнорировать дельты в пределах `requestAnimationFrame` после программного `setST`. Это не замена placeholder, а защита от похожих layout-shift сценариев.
- не отключать `scroll anchoring` глобально: это скроет симптом, но метка ActiveFilters всё равно прыгнет.

### Проверено: `<fieldset disabled>` как замена на время «выреза»

Вариант «клонировать блок, а в home оставить `<fieldset disabled>`» проверен в браузере.

Результат для контролов внутри `fieldset disabled`:

- `new FormData(form)` их **не включает** — даже если `name` остался;
- `form.checkValidity()` их игнорирует: `required` у них не блокирует отправку;
- `el.matches(':disabled')` → `true`, `el.willValidate` → `false`;
- при этом `form.elements` их всё ещё содержит, и `el.disabled` у самого input остаётся `false`.

Клон вне fieldset с `form="..."` (так его связывает `associatePortalControls`) в `FormData` попадает — это и нужно: пока popup открыт, отправляется клон.

Важный отрицательный результат: **удалить только `name` недостаточно**. Nameless `required`-контрол всё равно валидируется и блокирует submit. `inert`, `hidden`, `display:none` тоже не исключают из валидации и `FormData` (если `name` остался). Работает именно `disabled`/`fieldset disabled`.

Что учесть, если идти этим путём:

1. Fieldset должен резервировать высоту блока: `display:block; box-sizing:border-box; height:<h>px; margin:0; padding:0; border:0; min-inline-size:0; overflow:hidden`.
2. Клон нельзя класть внутрь disabled fieldset — он станет disabled. Клон живёт в popup/портале.
3. Клон и оригинал получат одинаковые `id`; нужно развести id и `for`/`aria-*`, иначе label клона может вести на скрытый оригинал.
4. Это копия: правки в клоне надо синхронизировать обратно в оригинал при закрытии (или заменять оригинал клоном). Иначе после закрытия форма покажет старое значение.
5. Если код читает `form.elements`, а не `FormData`, он увидит и disabled-оригинал; проверять `:disabled`/`willValidate`.

Вывод: `<fieldset disabled>` — рабочий вариант, но он дороже placeholder-а из-за синхронизации состояния и id. Если клон не нужен, placeholder + возврат того же узла проще и не создаёт второй источник истины.

### Тесты

- Browser (`test/browser/paginate.mjs` или новый `test/browser/filter-block-header.mjs`):
  - раскрыть фильтры, прокрутить до `data-progress=1`, кликнуть метку, проверить `data-progress` остаётся `1` и `main.scrollTop` не уменьшается;
  - закрыть popup, проверить возврат узла и сохранение позиции;
  - mobile 432 px: тот же сценарий с bottom sheet.
- Компонентный тест `FilterBlock`: home получает placeholder на время открытия, после закрытия placeholder удалён, `root` вернулся в тот же родитель, `FormData` не содержит placeholder.
- Ручная проверка: клавиатурный фокус в поле, `Escape`, повторное открытие, смена фильтра.

### Критерий готовности

Клик по ActiveFilters не меняет `data-progress` и `main.scrollTop`; шапка остаётся скрытой. Закрытие popup также не вскрывает шапку.

---

## P1. Публичная проекция списка профилей

Файлы: `src/content/user/profile.ts`, `ports.ts`, `gateway.server.ts`, `ui/profiles/source.ts`, `ui/ProfilesList.svelte`.

1. Ввести явный тип публичной строки:
   ```ts
   export type ProfileListView = {
     id: string          // тот же authId — ключ строки/навигации
     nickname: string | null
     avatarUrl: string | null
     createdAt: number
   }
   ```
   Если нужен отдельный `navigationId`, назвать его явно; не тащить `updatedAt`.
2. `ProfilesPage.items: ProfileListView[]`; `ProfilesRouteData`/`profilesSnapshot` — тот же тип.
3. В `profilesAdapter().listPage` задать `fields: ['auth_id', 'nickname', 'avatar_url', 'created_at']` и маппить только эти поля.
4. `ProfileView` оставить для чтения владельцем/`profile.read`.
5. Не отображать `id`/`authId` в карточке; для `Listing` использовать `id = authId` или `id` строки, но без лишних полей в payload.

Тесты:

- guest: только профили с `profile.visibility = all`, payload не содержит `updatedAt`;
- signed-in без `profile.read`: `all` + `users`;
- `nobody` не попадает;
- `profile.read` получает полную строку только в своём API;
- сериализованный `load` payload, а не только HTML.

---

## P1. Контракт набора revoke: запретить смешение форм

Файлы: `src/content/user/sessions.server.ts`, `src/content/user/types.ts`, `src/content/user/ui/session-delete/session-delete.form.server.ts`, `src/content/user/bulk.ts`.

1. Сделать `RevokeBulkArgs` дискриминируемым union:
   ```ts
   type RevokeBulkArgs =
     | { kind: 'ids'; ids: readonly string[] | string; authId?: string | null }
     | { kind: 'slice'; where?: SessionsWhereArgs; except?: readonly string[];
         authId?: string | null; includeCurrent?: boolean; onlyCurrent?: boolean }
   ```
   `kind` обязателен; лишние поля не проходят тип.
2. На серверной границе — runtime-проверка: ровно одна форма; смешение → `auth.confirm` без side effects. Можно переиспользовать `parseBulkInput`/`parseBulkSet`, но не терять `authId`/`includeCurrent`/`onlyCurrent`.
3. В `session-delete.form.server.ts` считать `ids` и `slice` взаимоисключающими: если заполнены оба — отказ, а не выбор среза.
4. `kind: 'slice'` без `where` оставить только для явного «весь список» (например, `where: { state: 'all' }`), либо требовать явный маркер.

Тесты domain:

- только допустимые `ids`;
- смесь допустимых/неизвестных/чужих/удалённых — частичный исход;
- текущая сессия + `current: true`, куки не снимаются generic-revoke;
- лимит `SESSIONS_BULK_IDS_LIMIT` — отказ без удаления;
- дубликаты и битые id;
- `kind: 'slice'` + `ids` — отказ, ни одна строка не удалена;
- `kind: 'ids'` + `where` — отказ;
- rollback при ошибке транзакции;
- `requested`/`revoked` для обеих форм.

Формы:

- POST с `ids` и заполненным slice-полем — ошибка `auth.confirm`, список не меняется;
- POST только с `ids` — закрывается ровно набор;
- POST только со slice — прежнее поведение.

---

## P2. ActiveFilters: снятие значения при наличии блока

Решение нужно принять явно. Рекомендация:

1. Рядом с объединённой меткой оставить кнопку `×` с `aria-label="Снять фильтр «Жанры»"`, которая снимает **все** значения этого поля через `onRemove` для каждого chip группы.
2. В popup сохранить снятие отдельных значений (там уже живёт форма).
3. Не возвращать старые отдельные чипы для полей с блоком — это сломает компактную раскладку.
4. Восстановить тесты `filter-block.svelte.test.ts`-уровня: перенос/возврат, клавиатура, снятие одного значения, снятие группы, SSR/no-JS.

Если решат, что метка-попап — единственный путь снятия, зафиксировать это в README `components/paginator/filters` и добавить тест, что кнопка `×` не нужна. Сейчас поведение не описано и выглядит как потеря функции.

---

## P2. Единый ключ выбора для списков

Файлы: `ui/SessionsList.svelte`, `ui/SeedUsersList.svelte`, `ui/BlocksList.svelte`, `hooks/use-list-selection.svelte.ts`.

1. Вынести `selectionSliceKey({ actor, target, filters, pageSize })` в общий модуль.
2. `SeedUsersList`: актор + поиск/фильтры + размер порции.
3. `BlocksList`: актор + `fixedUid` + фильтры + размер порции.
4. `SessionsList`: оставить текущую логику, перевести на общий helper.
5. Ключ сериализовать стабильно (JSON/`URLSearchParams` с сортировкой), не склейкой через `|`.
6. Номер страницы не включать, если выбор должен переживать пагинацию.

Тест: сменить фильтр без перемонтирования списка — набор очищается.

---

## P2. Размер страницы ProfilesList

Файл: `src/routes/(site)/(app)/profiles/+page.server.ts`.

1. Нормализовать `profiles.size` к `PROFILES_PAGE_SIZES` тем же правилом, что клиентский adapter: `31 → 30`, `51 → 50`, `101 → 100`.
2. Тесты: `31`, `0`, `101`, мусор, отсутствие.
3. Проверить, что `profilesSnapshot` и `Paginator` видят одинаковый `pageSize`.

---

## P2. Мелкие контракты и гигиена

1. `logoutLocal()`: проверить `r.ok` в `session-delete.form.server.ts`, даже если сейчас всегда `true`. Не менять поведение успеха.
2. `/profiles`: использовать `profilesListRoute.href()` в `ProfilesList` и `profiles/source.ts`.
3. `ProfilesList`: дата через `TimeAgo` или `Intl.DateTimeFormat` с фиксированной `timeZone: 'UTC'`; проверить SSR/CSR.
4. `UserConfig`/`frame`: добавить браузерный тест на шаг `security.sessions`; если обнаружится цикл от записи `$state` в рендере — перенести сбор snippets в эффект/микрозадачу, не менять `frame` на `{@render}`.
5. `git diff --check`: убрать пустые строки EOF и trailing whitespace.
6. Разбить будущие изменения на тематические коммиты: profiles, revoke, filters/header, docs.

---

## Порядок работ

1. **P0**: placeholder в `FilterBlock` + browser-тест вскрытия шапки.
2. **P1**: DTO профилей + тесты проекции.
3. **P1**: дискриминируемый `RevokeBulkArgs` + form-guard + domain-тесты.
4. **P2**: ActiveFilters UX + тесты.
5. **P2**: selection key, page size, дата, route registry.
6. **P3**: `git diff --check`, разбиение sync-коммита.

## Проверки после каждого шага

- `KIT_ADAPTER=node npm run check`
- `npx vitest run` (или узкие suites на изменённые файлы)
- `npm run test:guard`
- для P0 — целевой browser-сценарий; полный `test:browser` в окружении без `libnspr4.so` не запускается.
- `npm run test:size` — отдельный бюджетный вопрос; не поднимать лимиты без решения владельца.

## Открытые вопросы

1. Публичная строка профиля: `id` = `authId` или отдельное поле `navigationId`?
2. ActiveFilters: кнопка `×` на группу или только снятие внутри popup?
3. `kind` в `RevokeBulkArgs`: делать обязательным сразу (ломает старые вызовы) или ввести переходный runtime-guard?
4. `test:size`: принимать текущий рост или выделять отдельную задачу на снижение веса?
