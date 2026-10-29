# Аудит языкового контракта ошибок (`EN + code` → `RU UI`), вызовов `console.*` и слабых мест приложения

> Статус документа: **только аудит перед объединением веток двух ИИ**. Рантайм-код и вызовы `console.*` этим аудитом не менялись.

---

## 1. Целевой архитектурный контракт

1. **Сервер, ядро библиотек (`src/lib/*`), хуки (`src/hooks/*`), серверная прослойка (`src/server/*`), схемы окружения (`src/env.ts`) и серверные обработчики (`*.server.ts`) НЕ формируют русские ошибки.**
   - На провод (HTTP JSON, `wss://` JSON, `Result.errors`, `ApiErrorBody`), в доменные исключения и во внутренние контракты уходит **английский `message` + стабильный машинный `code` (+ `params`)**.
2. **Русский язык допустим только у `label` и в слое `UI`** (шаблоны `.svelte`, подписи/подсказки полей форм и демо-панелей, клиентские/UI-словари расшифровки `code + params → русский текст`).
3. **Консоль (`console.*`)**: пока оставлена без изменений (полный пофайловый реестр вынесен в Раздел 4). При добавлении единого `env`-ключа языка (например `APP_LOCALE` в `src/env.ts`) он сможет одновременно задавать язык общения сервера/логов и язык UI по умолчанию.

---

## 2. Главный архитектурный разрыв в `#lib/form`

В `#lib/form` уже заложена структура `FormError = { id, code, params, path, message, origin }` и функция `normalizeErrors(errors, render, limits)` (`src/lib/form/result.ts:123-144`), но **клиентская расшифровка серверных кодов сейчас не срабатывает по двум причинам**:

### 2.1. `bind()` на клиенте не прогоняет серверные `result.errors` через словарь `render`
- В `src/lib/form/submit.ts:276` (`runSubmit`) при получении ответа от транспорта возвращается сырой `outcome.result` без вызова `normalizeErrors(..., render)`.
- В `src/lib/form/svelte/bind.svelte.ts:326-346` (`applyResult`, куда приходят и ответы `fetch`/`wss://`, и SSR-ответы без JS через `lift(o.continuation)` на `L353`) `result.errors` записываются напрямую в `facts` и `shown` без `normalizeErrors(result.errors, render, desc.policy.limits)`.
- В результате сегодня любые серверные ошибки (например `AUTH_MESSAGES` в `seed-form`) оказываются на русском **только потому, что их перевёл сам сервер внутри `createFormHandler` (`src/lib/form/server.ts`)**. Как только сервер начнёт присылать `{ code: 'auth.signature', message: 'Invalid signature' }`, форма без доработки `applyResult` выведет пользователю английский `"Invalid signature"`.
- При этом сама `normalizeErrors` (`src/lib/form/result.ts:137-138`) уже поддерживает нужный приоритет:
  ```ts
  const rendered = render(e.code, e.params, { path: e.path, template: e.template })
  const message = rendered === e.code && e.message && e.message !== e.code ? e.message : rendered
  ```
  Если UI-словарь знает `e.code` (`rendered !== e.code`), он заменяет серверный английский `e.message` на русскую строку с подстановкой `e.params`; если код чужой и словарю неизвестен — сохраняет `e.message` как фолбэк.

### 2.2. Русский словарь `ru` жёстко вшит в ядро `#lib/form` (`messages-order.ts` + `messages.ts`)
- `src/lib/form/messages-order.ts:20` безусловно собирает `makeRenderer([form, app, ru], interpolate)`. Из-за этого `createFormHandler` на сервере по умолчанию штампует русские сообщения для всех системных кодов (`origin.rejected`, `body.too-large`, `rate.limited`, `handler.failed` и т.д.).
- **Прямая связь с бюджетом размера `#lib/form`**: сейчас тест `tooling/form-size.test.mjs` падает всего на **`805` байт gzip** (`110 805` при потолке `110 000`). Двухбайтовая кириллица UTF-8 в `src/lib/form/messages.ts` (`9.75 КБ`) и русские строки исключений в `validators.ts`, `spec.ts`, `server.ts`, `bind.svelte.ts` съедают этот запас.
- **Решение после слияния**:
  1. В `src/lib/form/messages.ts` оставить компактный базовый английский словарь `en` (1 байт на символ ASCII);
  2. Вынести полный русский словарь `ru` (системные коды формы + коды хранилища/транспорта/БД) в UI-слой `src/components/form/messages.ru.ts` и подключить один раз в `createConfig({ messages: ru })` в `src/components/form/forms.config.ts`;
  3. Вызывать `normalizeErrors(result.errors, render, desc.policy.limits)` внутри `applyResult` в `src/lib/form/svelte/bind.svelte.ts` (работает одинаково для JS `fetch`/`wss://` и для SSR-рендера `<Form>` без JS).

---

## 3. Полная карта русских строк вне `label` и UI

> Не включены в список нарушений (законный слой `label` и UI): `.svelte`-компоненты, подписи/плейсхолдеры/подсказки полей в `forms.ts` / `form.ts` / `demo-schema.ts` / `nav.ts` / `filters.ts`, витринные описания `src/content/user/{acl.ts,permissions.ts,spec-*.ts}` и UI-модели `src/components/ui/{attachment/model.ts,phone-input/phone.ts,time/time-ago.ts}`.

### 3.1. `src/env.ts`
- `L23, 37, 42, 49, 60, 78` — все функции проверки окружения (`optional`, `flag`, `secret`, `positiveInteger`, `wsChunkBytes`) возвращают русские `issues[].message` при отказе запуска сервера (`«ожидалась строка»`, `«нужно не короче 32 символов...»`, `«допустимый диапазон сегмента 64kb..16mb...»`).

### 3.2. Пакеты `src/lib/*`

| Пакет | Где сейчас русские ошибки / строки | Детали |
|---|---|---|
| `#lib/form` | `messages.ts:9-112`, `server.ts:316,433,511,591-596,753,851`, `spec.ts:73-166`, `validators.ts:99-148,286-487`, `queued.ts:30-31`, `registry.ts:31`, `validate.ts:46`, `svelte/bind.svelte.ts:881`, `svelte/config.ts:120-121`, `svelte/field-set.svelte.ts:47` | Русский базовый словарь `ru`; русские тексты в `defect('spec.*', ...)` (`spec.ts`); русские `throw new Error / TypeError`; русские описания `why` в `opaque(...)`; `detail: 'транспорт не настроен'` (`bind.svelte.ts:881`). *(В `strength.ts:43,47` слова `'пароль'`, `'йцукен'` и `[а-яё]` — словарные эвристики оценки пароля, а не ошибки).* |
| `#lib/storage` | `index.ts` (54 строки: `L215, 226, 263, 283-305, 395-411, 476, 606, 675, 692, 935, 1064, 1179, 1368-1381, 1408-1538, 1589-1872, 2265-2873`), `s3.ts` (`L81-106, 243, 308-519, 693, 832-868`), `webdav.ts` (`L168-187, 330, 433-441, 511, 585-676, 713-969`), `crypto.ts` (`L45-172, 309-497`), `concurrency.ts` (`L29-148`), `upload.ts` (`L164, 212-238, 354, 376`), `local.ts` (`L53, 81, 131, 143, 259, 426`), `memory.ts` (`L47, 55`) | Все доменные исключения (`StorageReadOnlyError`, `StorageConflictError`, `StorageCryptoError`, `StorageConcurrencyError`, `StorageUploadError`), `RangeError`/`TypeError` и диагностика `probe()` формируются на русском. При этом машинный `code` сейчас есть только у `StorageUploadError` — остальным классам ошибок `#lib/storage` нужно добавить поле `code` + `params`. |
| `#lib/db` | `adapters/pg.ts:71`, `adapters/proxy.ts:240,326,330,357,387-466`, `chain.ts:36-231`, `clone.ts:28-98`, `query/sql.ts:194`, `raw.ts:66-205`, `resource.ts:99-103,682-781,885`, `rules.ts:43`, `sveltekit/cursor.ts:25-53`, `sveltekit/node.ts:66,107,130-131,222`, `sync/admin.ts:84-115`, `sync/decisions.ts:85-166`, `sync/index.ts:105-110+` | В `DbFailure` уже есть машинный `kind`, но массив `issues[]`, ответы `sync/admin.ts` (`«Секрет не подошёл.»`, `«Схема уже изменилась...»`) и исключения `cursor.ts` / `node.ts` пишутся по-русски. |
| `#lib/address` | `keys.ts:57-186`, `routes.ts:364`, `sveltekit.ts:312, 322` | Русские `Error` конфликтов бронирования query-ключей и зашитый `label: 'Переход'` в `sveltekit.ts`. |
| `#lib/cache` | `memory.ts:49,55,106,116,155`, `types.ts:73` | Русские `RangeError` / `TypeError`. |
| `#lib/modals` | `core-contract.ts:157-173`, `loader.ts:126,128,150,344,360`, `registry.ts:81-187`, `svelte/context.ts:181`, `svelte/state.svelte.ts:104` | Русские исключения и рантайм-ответы загрузчика `loader.ts` (`'Ошибка загрузки'`, `'Нет такой модалки: ...'`, `{ ok: false, error: 'Отменено' }`). |
| `#lib/paginate` | `adapter-url.ts:140,195,203`, `core.ts:211,773,988`, `filters/params.ts:167`, `search/accumulator.ts:454`, `source.ts:189,238,271,301,309` | Русские `Error` и причины отбрасывания query/extra-параметров. *(В `search/fuzzy.ts` кириллица относится к раскладке/фонетике нечёткого поиска — это данные алгоритма).* |
| `#lib/task` | `index.ts:57` | Строка прогресса `шаг X из Y` собирается внутри ядра `#lib/task`. |
| `#lib/fetch`, `#lib/image` | `0` нарушений | Эталон: только английские сообщения + строгие машинные коды (`FetchError.code`, классы ошибок `lib/image`). |

### 3.3. Слой хуков `src/hooks/*` и сервера `src/server/*`
- **`src/hooks/component-form/`**:
  - `ws-magic.ts:63-144` — возвращает русские описания несовпадения магических байт вместо кода (`file.signature-mismatch` + `{ expected }`);
  - `ws-session.server.ts:532, 583, 595, 613, 721-722, 796-797, 1090` — отправляет с сервера русские тексты ошибок в `fault` и `WsUploadFieldError` (хотя коды `file.hmac-missing`, `file.hmac-mismatch`, `file.changed`, `file.unreadable`, `file.size-mismatch` уже сформированы рядом);
  - `ws-transport.ts:108-110, 143-149, 725` — формирует русские подписи фаз прогресса и текст ошибки `ws.closed-early` внутри транспорта;
  - `upload-eta.ts:39-170` и `upload-progress.svelte.ts:32-40` — смешивают математику расчёта ETA/бюджета платформы с русским склонением минут и `UPLOAD_LIMIT_WARNING_RU` (тексты и склонения следует держать в UI-компоненте `UploadForecastBanner.svelte`);
  - `authorize.server.ts:25` — дефолт `'Доступ запрещён'`;
  - `server.server.ts:171-172` — ответ `413` `{ message: 'слишком большое тело запроса' }` без кода `body.too-large`;
  - `transport.ts:17-22, 64, 151` — словарь `REASON` переводит HTTP-статусы `400..429` в русский прямо в транспорте (вместо перевода кодов `transport.400`..`transport.429` словарём формы).
- **`src/hooks/cookie-vault/`**:
  - `schema.ts:43, 48` — русские `RangeError`;
  - `vault.server.ts:260, 268, 283` — `saveVaultEntry` возвращает с сервера русские строки ошибок без машинного `code` (`vault.invalid-id`, `vault.max-entries`, `vault.cookie-too-large`).
- **Остальные модули `src/hooks/*`**:
  - `api-error.ts:64`, `cache-db.ts:83,200,202,205`, `db-form.ts:91`, `db-schema.server.ts:78,82,86,96`, `graphql.server.ts:92-97,112`, `storage-db.ts:288`, `task-stream.server.ts:134` (`apiErrorBody('Внутренняя ошибка сервера', 'internal')`), `links/{link.svelte.ts,modal-link.svelte.ts}`, `js-only.svelte.ts:14`.
- **`src/server/*`**:
  - `api-error.server.ts:22, 26` — формирует русский `error` (`${what}: внутренняя ошибка сервера`) на сервере;
  - `db.server.ts:113-115, 136, 161-162, 229` — русские исключения `DB_CURSOR_*` и серверные текстовые метки `taskResponse` (`'Запуск базы'`, `'Подключение'`, `'Проверка схемы'`);
  - `fetch.server.ts:68-71` — русские строки ожидания `'Повтор X из Y'` и `'Очередь API: ...'` с сервера.

### 3.4. Серверные модули в `src/content/*` и `src/routes/*`
- `src/content/storage-vault/schema.ts:92-135` и `vault.form.server.ts:80, 97` — русские ошибки парсинга и проверки сервера без `code` (`vault.probe-failed`, `vault.unreachable`).
- `src/content/user/{config.ts:74-88, error.ts:88, gateway.server.ts:474,723, schema.ts:42, ui/seed-form/seed.form.server.ts:20, ui/seed-users/source.ts:135,143,148}` — русские исключения и подстановка `'не указана'` на сервере *(при этом разделение `content/user/error.ts` на коды `auth.*` и `content/user/messages.ts` на UI-тексты уже соответствует целевой схеме)*.
- `src/content/demo-catalog/{items/items.ts:65,96, posts/list.server.ts:70-78,191,231,249, rickmorty/rickmorty.server.ts:138,185,197,257-262, rickmorty/rickmorty.ts:92,101, shikimori/filters.server.ts, shikimori/schema.server.ts, shikimori/shikimori.server.ts:119,143,146, shikimori/shikimori.ts:155,167,184,194}` и `src/routes/api/{db-posts,rickmorty/characters,shikimori/animes,shikimori/filters,shikimori/terms}/+server.ts` — сервер отдаёт готовые русские `error` и `dropped[].reason`.
- Серверные формы маршрутов:
  - `src/routes/(site)/(app)/upload-demo/upload.form.server.ts:79, 108, 139, 261, 292, 295, 327, 331` — вызовы `fail([{ message: '...по-русски...' }])` (в `L261..331` даже без `code`);
  - `src/routes/(site)/(app)/db-demo/{db.form.server.ts:42,70,78,101,114, handle.server.ts:14-20,41}`;
  - `src/routes/(site)/(app)/fields/fields.form.server.ts:70, 74`;
  - `src/routes/(site)/(app)/steps/steps.form.server.ts:22, 30`;
  - `src/routes/(site)/(modals-demo)/registry.ts:20` (`throw new Error('отменено')`).

---

## 4. Полный реестр всех вызовов `console.*` в рантайме `src/`

Всего в рантайме `src/` (без учёта `*.test.*` и автономных лабораторных скриптов `src/lib/db/probes/*.mjs`, `src/lib/db/test/ported/*.script.ts`) найдено **39 вызовов `console`** (включая 1 вычисляемый вызов `console[level]`):

| № | Файл : строка | Вызов | Язык | Что выводится |
|---:|---|---|---|---|
| 1 | `src/components/form/Field.svelte:116` | `console.warn` | RU | `'[Field] takeover не включён: поле не несёт живой ручки связки. Передавайте в \`of\` вид поля из bind (\`bound.f.<поле>\`), а не собранный вручную объект.'` |
| 2 | `src/components/form/Field.svelte:128` | `console.error` (`DEV`) | RU | `` `[Field] takeover поля '${name}' упал при монтировании:` ``, `err` |
| 3 | `src/components/form/Field.svelte:154` | `console.warn` | RU | `'[Field] замена перехватчика не включена: \`base\` не совпал с примитивом, который resolve дал этому полю...'` |
| 4 | `src/components/form/Field.svelte:169` | `console.warn` | RU | `'[Field] вместо подмены рисуется обычный resolve: у компонента из \`instead\` нет записи в реестре BASE_OF...'` |
| 5 | `src/components/steps/steps.svelte.ts:158` | `console.warn` (`DEV`) | RU | `'[steps] ' + message` (дубликаты ключей шагов / `switch()` в режиме `url`) |
| 6 | `src/components/ui/select/select-trace.ts:215` | `console.info` | EN | `` `[modals/select-trace] ${JSON.stringify(...)}` `` |
| 7 | `src/content/demo-catalog/shikimori/filters.server.ts:271` | `console.warn` | RU | `` `[shikimori] фильтр «${item.key}» не применён: ${item.reason}` `` |
| 8 | `src/content/demo-catalog/shikimori/schema.server.ts:506` | `console.warn` | RU | `` `[shikimori-schema] ${api}: обновление не удалось, отдаю схему от ${cached.schema.builtAt}: ${String(error)}` `` |
| 9 | `src/hooks/app-errors.svelte.ts:59` | `console.error` (`DEV`) | код | `` `[${e.lib}:${e.code}]` ``, `e.cause` |
| 10 | `src/hooks/app-errors.svelte.ts:68` | `console.warn` | код | `` `[${e.lib}] ${e.code}` ``, `e.cause` |
| 11 | `src/hooks/cache-db.ts:116` | `console.error` | RU | `'[cache] pgStore: вычистка просроченного не удалась'`, `e` |
| 12 | `src/hooks/component-form/ws-session.server.ts:1142` | `console.error` | RU | `'[ws-session] непредвиденный сбой потоковой формы:'`, `err` |
| 13 | `src/hooks/db-form.ts:104` | `console.warn` | RU | `` `[db] formParams(${resource.key}): поле формы «${name}» развернуло параметры «${owner}»` `` |
| 14 | `src/hooks/storage-db.ts:211` | `console.error` | RU | `'[storage] pgStorageLedger: вычистка просроченных броней не удалась'`, `err` |
| 15 | `src/hooks/task-stream.server.ts:133` | `console.error` | код | `'[task-stream]'`, `error` |
| 16 | `src/lib/db/sveltekit/node.ts:245` | `console.error` | EN | `'Idle PostgreSQL connection failed'` |
| 17 | `src/lib/form/keep.ts:17` | `console.warn` (`DEV`) | RU | `` `${message} — заменяю (горячая замена)` `` |
| 18 | `src/lib/form/server.ts:835` | `console.error` | RU | `'[form] сбой приёма запроса'`, `e` |
| 19 | `src/lib/form/svelte/bind.svelte.ts:304` | `console.warn` (`DEV`) | RU | `` `[form] обработчик убрал ${shown.removed} из ${facts.length} ошибок` `` |
| 20 | `src/lib/form/svelte/bind.svelte.ts:646` | `console.error` (`DEV`) | RU | `` `[form] форма '${desc.id}': в разметке нет полей: ${missing.join(', ')}. Разместите каждое поле field(name) или уберите его из описания.` `` |
| 21 | `src/lib/form/svelte/bind.svelte.ts:656` | `console.error` (`DEV`) | RU | `` `[form] форма '${desc.id}': в разметке нет полей конверта: ${missing.join(', ')}. Разверните form.hidden() внутри элемента формы.` `` |
| 22 | `src/lib/modals/svelte/ModalHost.svelte:300` | `console.warn` (`DEV`) | RU | `` `[modals] имя «${entry.name}» не объявлено ни в одной области страницы` `` |
| 23 | `src/lib/paginate/adapter-url.ts:139` | `console.warn` | RU | `` `[paginate] extra-ключ "${base}.${key}" отброшен: ${reason}; сырое значение: ${JSON.stringify(raw)}` `` |
| 24 | `src/lib/paginate/core.ts:210` | `console.warn` (`DEV`) | RU | `` `paginate: источник «${instance.name}» вернул ключ extra «${key}», которого нет среди объявленных; ключ записан не был.` `` |
| 25 | `src/lib/paginate/filters/params.ts:86` | `console.warn` (`DEV`) | RU | `` `[filters] ${message}` `` (русский `message` из `L167`) |
| 26 | `src/lib/paginate/filters/schema.ts:372` | `console.warn` | RU | `` `[catalog-filter] ${schema.source}: скрыто ${truncated} опций сверх лимита ${limit} (деградация схемы)` `` |
| 27 | `src/lib/paginate/source.ts:198` | `console.warn` | RU | `message` (русские предупреждения из `L238, L271`) |
| 28 | `src/lib/storage/store.ts:109` | `console.error` | RU | `` `[storage] опция «${optionName}» проигнорирована: не передан ${missingRequirement}` `` |
| 29 | `src/routes/(site)/(app)/paginator/sources.ts:153` | `console.warn` | RU | `` `[rickmorty] фильтр «${item.key}» не применён: ${item.reason}` `` |
| 30 | `src/routes/(site)/(app)/paginator/sources.ts:183` | `console.warn` | RU | `` `[shikimori] фильтр «${item.key}» не применён: ${item.reason}` `` |
| 31 | `src/server/admin-bootstrap.server.ts:61` | `console.info` | RU | Многострочный блок `[user] администратор создан` + `seed` + `ключ для входа` |
| 32 | `src/server/after-response.server.ts:44` | `console.error` | RU | `'[afterResponse] задача после ответа упала:'`, `error` |
| 33 | `src/server/api-error.server.ts:22` | `console.warn` | код+текст | `` `[${where}] ${error.code}: ${error.message}` ``, `error.cause ?? ''` |
| 34 | `src/server/api-error.server.ts:25` | `console.error` | код | `` `[${where}]` ``, `error` |
| 35 | `src/server/db.server.ts:259` | `console[r.status === 'ok' ? 'info' : 'warn']` | RU | `` `[db] схема: применено ${r.applied.length}, конфликтов ${r.conflicts.length}, ждут решения ${r.notices.length}` `` |
| 36 | `src/server/db.server.ts:273` | `console.warn` | RU | `'[user] администратора завести не удалось:'`, `message` |
| 37 | `src/server/db.server.ts:280` | `console.error` | RU/EN | `'[db] открыть БД не удалось:'`, `kind`, `message`, `details`, `cause` (`'нет'`) |
| 38 | `src/server/vite-ws.server.ts:79` | `console.error` | RU | `'[vite-ws] сбой при апгрейде WebSocket:'`, `err` |
| 39 | `src/server/ws-upgrade.server.ts:304` | `console.error` | RU | `'[ws-upgrade] сбой обработчика Cloudflare WebSocket:'`, `err` |

### Рекомендуемая схема под будущий `env`-ключ языка (`APP_LOCALE`)
Поскольку модули `src/lib/*` по правилу `core-purity` не импортируют `$app/env/private`:
1. Внутри `src/lib/*` диагностика отдаётся структурно (`{ lib, code, params, cause }`, по образцу `src/hooks/app-errors.svelte.ts`) либо коротким английским сообщением по умолчанию.
2. В `src/env.ts` и `.env.example` добавляется ключ `APP_LOCALE` (`'en' | 'ru'`), который читается в `src/server/` для выбора языка серверных логов/ответов и передаётся из корневого `+layout.server.ts` как язык UI по умолчанию.

---

## 5. Найденные слабые места и уязвимости

### Высокий приоритет (`High`)

1. **Мёртвый код `sameOrigin` в `originGuard` (`src/server/form-security.server.ts:47-52` + `src/server/trusted-origins.ts:39-57`)**
   - `localOrigins()` всегда возвращает минимум 4 локальных адреса (`localhost:5173,5174`, `127.0.0.1:5173,5174`), поэтому в `return exact.length ? strict(ctx) : sameOrigin(ctx)` условие `exact.length` всегда `>= 4`, и ветка `sameOrigin(ctx)` **никогда не выполняется**.
   - В результате на любом продакшен/превью-домене (например `*.vercel.app`, `*.pages.dev` или локальном `vite preview` на `:4173`), если точный адрес не прописан в `KIT_TRUSTED_ORIGINS`, сервер отклоняет собственные same-origin отправки форм и `wss://`-рукопожатия с `403 origin.rejected`.
   - **План исправления**: в начале `originGuard` пропускать `if (sameOrigin(ctx) === undefined) return undefined`, а `patterns` и `strict(ctx)` применять к кросс-доменным/проксированным источникам.

2. **Сброс `idleTimer` кадрами `pong` при нулевом движении байтов + отсутствие лимита размера `activeUploadSessions` (`src/hooks/component-form/ws-session.server.ts:135, 685-690, 1032`)**
   - В `attachControlFrameHandler` вызов `touchActivity()` стоит перед `if (ctrl?.type === 'pong') return`. Сервер сам шлёт `ping` каждые `25 с`, браузер отвечает `pong`, и `idleTimer` (`90 с`) обновляется бесконечно даже при `0` переданных файловых байтов (вплоть до `UNBOUNDED_HANDLER_TIMEOUT_MS = 24 часа` на Node/Cloudflare).
   - У `activeUploadSessions` (`Map` припаркованных на `60 с` мобильных сессий) нет потолка `MAX_PARKED_SESSIONS`, что создаёт риск удерживания памяти при массовых обрывах `1006`.
   - **План исправления**: не сбрасывать таймер ожидания файловых сегментов (`pendingPulls.size > 0`) пустыми `pong`-кадрами и ограничить размер `activeUploadSessions` (например, `<= 256` с вытеснением старейших).

3. **SSRF и эхо фрагмента ответа внутренней сети при предсохранительной проверке сервера в `CookieVault` (`src/content/storage-vault/vault.form.server.ts:41-99` + `src/lib/storage/webdav.ts:676`)**
   - `probeStorageVaultEntry` выполняет серверный `fetch` по пользовательскому `entry.url` без запрета loopback (`127.0.0.0/8`, `::1`), link-local облачных метаданных (`169.254.169.254`) и приватных подсетей RFC 1918 (`10/8`, `172.16/12`, `192.168/16`).
   - В `webdav.ts:676` в текст ошибки попадает `errText.slice(0, 180)` тела ответа сервера, который `vault.form.server.ts:97` пробрасывает в ошибку поля формы.
   - **План исправления**: добавить SSRF-фильтр целевых хостов/IP (с явным разрешением локальных стендов только в dev/тесте) и возвращать клиенту только безопасный `code` без фрагментов тела ответа.

4. **Тройной расход RAM на `multipart/form-data` в `peekFormDataBounded` (`src/hooks/component-form/server.server.ts:53-91`)**
   - На каждый POST с `multipart/form-data` вызывается `request.clone()` (`tee` потока в памяти) + сборка `Uint8Array(seen)` + `.formData()` исключительно для чтения строкового поля `__form_id`.
   - **План исправления**: передавать идентификатор компонентной формы в заголовке (для JS `fetch`) или query-параметре `action` (для no-JS), либо парсить только начальный заголовок потока до первого файлового поля.

### Средний приоритет (`Medium`)

5. **Пересоздание `createStorage` на каждый запрос и смешение общих демо-записей с персональными куками (`src/server/storage.server.ts:49-56, 155-200, 224-275`)**
   - `resolveRequestStorage(cookies)` конструирует новый `createStorage(...)` на каждый запрос, из-за чего in-memory состояние карантина `cooldownMs: 15_000`, курсор `round-robin` и серверные лимитеры `rate`/`concurrency` сбрасываются между запросами.
   - При этом `sharedUploadLedger` и `uploadedRecords` глобальны на весь процесс, тогда как слоты `CookieVault` индивидуальны для каждого браузера.

6. **Параметры безопасности `CookieVault` (`src/hooks/cookie-vault/vault.server.ts:44-50, 82-90, 316-320`)**
   - В ветке `sameSite: 'lax'` захардкожен `secure: false` даже при работе по `https://` (`event.url.protocol === 'https:'`);
   - В `deriveAesKey` используется одиночный `SHA-256` вместо `HKDF-SHA-256` с привязкой `info` к `scope`;
   - `resetVaultKey` удаляет все куки с префиксом `dv_` во всех `scope` сразу, а не только куки текущего `schema.scope`.

7. **Неподтверждённый `x-forwarded-for` в `resolveRequestMeta` (`src/server/storage.server.ts:124-127`)**
   - Чтение первого адреса из `x-forwarded-for` позволяет клиенту обходить `scope: 'ip'` в лимитерах хранилища подделкой заголовка (надёжнее прокидывать `event.getClientAddress()`).

8. **Отсутствие `params` в `ApiErrorBody` (`src/hooks/api-error.ts` + `src/server/api-error.server.ts`)**
   - Для перехода маршрутов `/api/*` на английский `error` + русскую клиентскую расшифровку по `code` в `ApiErrorBody` стоит добавить необязательный объект `params?: Record<string, string | number>`.

### Низкий приоритет (`Low`)

9. **Разнобой единиц объёма в UI (`КиБ/МиБ` vs `КБ/МБ`)**
   - `src/components/ui/attachment/model.ts:238-240` рендерит `КиБ / МиБ / ГиБ`, тогда как `src/lib/form/messages.ts:40-43` и `src/hooks/component-form/upload-eta.ts:39-56` рендерят `КБ / МБ / ГБ`.
