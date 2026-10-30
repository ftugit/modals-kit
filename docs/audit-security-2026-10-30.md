# Комплексный аудит безопасности системы (`2026-10-30`)

Статус: **узлы `S1`–`S7` и `S9`–`S12` исправлены в коде и покрыты регрессионными тестами; узел `S8` развёрнут в полную архитектурную спецификацию изоляции демо-контура через функции регистрации**.
Методика: сквозной статический анализ исходников всех слоёв (`src/env.ts`, `vite.config.ts`, `src/hooks.server.ts`, `src/server/*`, `src/content/user/*`, `src/content/storage-*`, `src/hooks/*`, `src/lib/*`, `src/routes/*`) со сверкой защитных паттернов по открытому коду через GitHub Code Search API (`sveltejs/kit`, `actualbudget/actual`, `kanwas-ai/kanwas`, `pacoyang/pi-glean`, `seanmorley15/AdventureLog`, `SveltyCMS/SveltyCMS`, `PetalNet/Nexus`, `TiszL/pixel-kingdom-wars`, `LF-Decentralized-Trust-labs/identity-bot`, `nuxt/nuxt`, `workos/workos-node`).

---

## 1. Уже действующие сильные стороны защиты

1. **Полная параметризация SQL и изоляция слоёв (`src/lib/db/query/sql.ts`, `tooling/*.test.mjs`)**:
   - все значения передаются строго позиционными параметрами `$1..$n`, а идентификаторы таблиц и колонок проверяются регулярным выражением `^[A-Za-z_][A-Za-z0-9_]*$`;
   - во всём дереве `src/` отсутствуют вызовы `{@html ...}` (`0` вхождений);
   - 146 архитектурных стражей проверяют границы библиотек, запрет сырых `<form>` и прямых мутаций `history`.
2. **Криптографические сравнения за постоянное время**:
   - проверка `DB_ADMIN_TOKEN` в `src/lib/db/sync/admin.ts` (`sameSecret` через `SHA-256` обоих входов + побитовый `XOR`);
   - проверка `resumeToken` и цепочки целостности сегментов WebSocket-выгрузки (`timingSafeHexEqual` / `timingSafeTagEqual` в `src/hooks/component-form/ws-integrity.ts`).
3. **Безопасная потоковая раздача файлов и защита от Path Traversal (`src/lib/storage/index.ts`, `src/server/app-storage.server.ts`)**:
   - `normalizeStoragePath` блокирует `..`, `\`, нулевые байты и служебные префиксы `.storage-*`;
   - `storage.serve` по умолчанию выставляет `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Content-Security-Policy: default-src 'none'; sandbox` и принудительный `Content-Disposition: attachment` для активных MIME-типов;
   - все HTTP-вызовы внутри `s3.ts` и `webdav.ts` выполняются с `redirect: 'manual'`, что предотвращает утечку заголовков `Authorization`.
4. **Защита от Open Redirect (`src/lib/address/core.ts`)**:
   - `localPath` парсит путь через `new URL(raw, 'http://local.invalid')` и сверяет `origin`, блокируя не только `https://` и `//`, но и обратные слэши `/\evil.com`.
5. **Шифрование секретов хранения (`iron-webcrypto` + `AES-256-GCM`)**:
   - `storage_server.sealed_config` запечатывается с поддержкой ротации ключей;
   - слоты `CookieVault` шифруются `AES-256-GCM` со связанными данными `AAD = "modals-kit:dv:v1:<scope>:<id>"` и привязкой ключа куки к серверному `AUTH_SEAL_SECRET`.

---

## 2. Сводная матрица узлов аудита и статус реализации

| ID | Уровень | Статус | Узел | Суть риска и результат |
|---|---|---|---|---|
| **S1** | **High** | **Исправлено** | `prepare-proof.ts`, `AuthWidget.svelte`, `SeedForm.svelte`, `seed.form.server.ts`, `auth.ts` | Приватный Ed25519-ключ (`secret`) больше не покидает браузер при включённом JS (`seed` перезаписывается публичным ключом до отправки + `secret: true` без SSR-эха), а `proveSeed` требует обязательную подпись `signature` |
| **S2** | **High** | **Исправлено** | `trusted-origins.ts`, `form-security.server.ts`, `vite.config.ts` | Собственный `origin` запроса всегда разрешён в `originGuard`, `localhost` исключён из чистой прод-сборки, а wildcard `*` ограничен `[a-z0-9-]+` с защитой от `@userinfo` |
| **S3** | **High** | **Исправлено** | `safe-storage-fetch.server.ts`, `app-storage.server.ts`, `storage.server.ts`, `vault.form.server.ts` | Общий SSRF-безопасный `fetch` с закреплением IP в `lookup` сокета (`1` DNS-запрос без TOCTOU rebinding) и проверкой редиректов подключён во все рантайм-пулы S3 / WebDAV |
| **S4** | **High** | **Исправлено** | `gateway.server.ts`, `cookie-vault/vault.server.ts` | Флаг `Secure` у `auth_sid`, `auth_tmp`, `dv_key` и `dv_*` динамически включается для всех `https:`-запросов даже в режиме `SameSite=Lax` |
| **S5** | **Medium** | **Исправлено** | `user/schema.ts`, `user/auth.ts`, `user/ports.ts`, `gateway.server.ts` | Поля `jti`, `version` и `subnet_salt` закрыты за `read: ['server']`, а `subnetHash` переведён на `HMAC-SHA-256` с серверным pepper из `AUTH_SEAL_SECRET` |
| **S6** | **Medium** | **Исправлено** | `client-ip.server.ts`, `gateway.server.ts`, `storage.server.ts` | Клиентский IP берётся из доверенного `event.getClientAddress()` (игнорируя клиентский спуфинг `X-Forwarded-For`), проверяется через `isIP` и канонизирует IPv4-mapped / IPv6 `/48` |
| **S7** | **Medium** | **Исправлено** | `auth.ts`, `gateway.server.ts`, `db-schema.server.ts`, `ws-session.server.ts`, `*.form.server.ts` | Одноразовое гашение `challenge.n` в `sharedStore`, лимит `50` активных сессий на аккаунт, `windowThrottle` на вход / `/schema` / хранилища и лимиты `activeUploadSessions` (`128` глобально, `8` на IP) |
| **S8** | **Medium** | **Спецификация** | `db.server.ts`, `hooks.server.ts`, `routes/**`, `content/**` | Полная архитектура упаковки демо-модалок, БД-моделей/сидов, форм, транспортов, маршрутов и навигационных ссылок в функции регистрации за флагом `DEMO_MODE` (раздел 4) |
| **S9** | **Low** | **Исправлено** | `hooks.server.ts`, `trusted-origins.ts` | Глобальный `securityHeadersHandle` (`nosniff`, `Referrer-Policy`, `Permissions-Policy`, `HSTS` на `https:`), а `PREVIEW_PORTS` больше не снимает `frame-ancestors 'none'` в проде |
| **S10** | **Low** | **Исправлено** | `src/env.ts`, `gateway.server.ts`, `app-storage.server.ts`, `vault.server.ts` | `AUTH_SEAL_SECRET` и `DB_CURSOR_SECRET` переведены на схему `secret` (`>= 32`), добавлена проверка `keyId` и `keyRotationList`, введены потолки длины до `Iron.unseal` |
| **S11** | **Low** | **Исправлено** | `src/lib/db/cursor/codec.ts` | Формат курсора `<kidB64>.<payloadB64>.<macB64>`: проверка `HMAC-SHA-256` выполняется по сырым байтам строго **до** `JSON.parse` |
| **S12** | **Low** | **Исправлено** | `vault.form.server.ts`, `upload-demo/vault/+page.server.ts` | Ручные проверки `startsWith('/')` заменены на единый `localPath()` из `#lib/address/index.js` |

---

## 3. Реализованные исправления (`S1`–`S7`, `S9`–`S12`)

### S1 [High] — Обязательная подпись Ed25519 в ядре и непередача приватного `secret` по сети

- **Реализация**:
  - `src/content/user/auth.ts`: в `EnterArgs` и `proveSeed` подпись `signature` сделана строго обязательной (`!args.signature` немедленно возвращает `auth.signature` до любого обращения к таблицам аккаунтов).
  - `src/content/user/ui/seed-form/prepare-proof.ts`, `AuthWidget.svelte`, `SeedForm.svelte`: перед отправкой формы в браузере локально вычисляются `pub = await seedOf(typed)` и `sig = await sign(challengeToken, typed)`, после чего поле `seed` в `FormData` перезаписывается публичным ключом (`fd.set('seed', pub)`, `fd.set('public_seed', pub)`), так что приватный `secret` вообще не пересекает сеть.
  - `src/content/user/ui/seed-form/form.ts`: поле `seed` помечено `secret: true` (контракт `#lib/form` не возвращает его значение в SSR `continuation`), добавлено скрытое поле `public_seed`.
  - `src/content/user/ui/seed-form/seed.form.server.ts`: при наличии `public_seed` и `signature` сервер передаёт их в ядро напрямую без вызова `seedOf`; конвертация сырого секрета в пару `{ seed, signature }` в памяти сервера оставлена исключительно для нативного HTML POST без JS.
- **Тесты**: `SeedForm.svelte.test.ts` (`S1`), `security-hardening.test.ts` (`S1 + S7`).

### S2 [High] — Исправление `originGuard`, исключение `localhost` из прод-списка и строгий wildcard

- **Реализация**:
  - `src/server/form-security.server.ts`: `originGuard` всегда пропускает совпадение канонического `Origin` (либо `Referer` без `Origin`) с собственным `new URL(ctx.request.url).origin`, а перед проверкой `patterns` отсекает любые строки с `username`/`password` (`@`), путём или нестандартной схемой.
  - `src/server/trusted-origins.ts` и `vite.config.ts`: `trustedOrigins(get, { dev })` включает `localOrigins` только в `dev`, в E2B-песочнице (`E2B_SANDBOX_ID`) или при явно заданном `PREVIEW_PORTS`; wildcard `*` компилируется в `[a-z0-9-]+` после валидации формы хоста.
- **Тесты**: `trusted-origins.test.ts`, `security-hardening.test.ts` (`S2 + S9`).

### S3 [High] — Защита от SSRF и DNS Rebinding во всех рантайм-пулах S3 / WebDAV

- **Реализация**:
  - `src/server/safe-storage-fetch.server.ts`: выделен единый потоковый `createSafeStorageFetch` на базе `node:http` / `node:https` с передачей проверенного результата `dns.lookup` напрямую в `lookup`-колбэк TCP/TLS-сокета (`1` обращение к DNS на соединение, полное отсутствие окна TOCTOU DNS Rebinding при сохранении TLS SNI `servername`) и ручной проверкой до `3` HTTP-редиректов со сбросом `Authorization` / `Cookie` при смене `origin`.
  - Подключён через `fetchImpl` в `probeStorageVaultEntry` (`vault.form.server.ts`), боевой пул `resolveAppStorage` (`app-storage.server.ts`) и запросное хранилище `resolveRequestStorage` (`storage.server.ts`).
- **Тесты**: `vault-probe.test.ts`, `security-hardening.test.ts` (`S3`).

### S4 [High] — Динамический флаг `Secure` у сессионных и сейфовых кук на `https:`

- **Реализация**:
  - `src/content/user/gateway.server.ts` (`cookieBaseOf`) и `src/hooks/cookie-vault/vault.server.ts` (`vaultCookieOpts` / `vaultDeleteOpts`): при `https:` флаг `secure: true` выставляется автоматически даже в режиме `SameSite=Lax`, сохраняя `secure: false` на локальном `http://localhost`.
- **Тесты**: `security-hardening.test.ts` (`S4`).

### S5 [Medium] — Закрытие `jti`, `version`, `subnet_salt` (`read: ['server']`) и `HMAC-SHA-256` с pepper

- **Реализация**:
  - `src/content/user/schema.ts`: поля `user_auth.subnet_salt`, `user_session.jti` и `user_session.version` переведены на `read: ['server']`.
  - `src/content/user/auth.ts`, `ports.ts`, `gateway.server.ts`: `subnetHash` переведён на `HMAC-SHA-256` с серверным `subnetPepper`, производным от `AUTH_SEAL_SECRET`.
- **Тесты**: `security-hardening.test.ts` (`S5`).

### S6 [Medium] — Доверенный клиентский IP через `event.getClientAddress()`

- **Реализация**:
  - `src/server/client-ip.server.ts`: `clientIpOf` читает платформенный `event.getClientAddress()` (игнорируя поддельный клиентский `X-Forwarded-For`), снимает `::ffff:` и `%zone`, валидирует адрес через `node:net` `isIP` и канонизирует IPv4 `/24` и полную развёртку IPv6 `::` до `/48`. Подключён в `gateway.server.ts`, `storage.server.ts` и `ws-session.server.ts`.
- **Тесты**: `security-hardening.test.ts` (`S6`).

### S7 [Medium] — Одноразовость `challenge`, потолки сессий и `windowThrottle`

- **Реализация**:
  - `auth.ts` + `gateway.server.ts`: использованные `challenge.n` атомарно гасятся в `sharedStore.scope('auth-challenge-nonce')` (+ in-flight `Set` против внутрипроцессной гонки) после прохождения проверок входа / `verifySeed`; число живых сессий одного аккаунта ограничено `MAX_ACTIVE_SESSIONS_PER_USER = 50` с мягким вытеснением старейших по активности.
  - `seed.form.server.ts`, `db-schema.server.ts`, `vault.form.server.ts`, `storage-server.form.server.ts`: подключён скользящий ограничитель `createIpThrottle` (`windowThrottle` из `#lib/form/server` поверх `sharedStore`).
  - `ws-session.server.ts`: введены потолки `MAX_ACTIVE_WS_SESSIONS_GLOBAL = 128` и `MAX_ACTIVE_WS_SESSIONS_PER_IP = 8` с отказом `429` + закрытием `1013`.
- **Тесты**: `security-hardening.test.ts` (`S1 + S7`), `ws-session.test.ts`, `ws-transport.test.ts`.

### S9–S12 [Low / Hardening] — Заголовки, строгие env-схемы, кодек курсора и `localPath`

- **Реализация**:
  - **S9**: `securityHeadersHandle` в `src/hooks.server.ts` выставляет `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` и `Strict-Transport-Security` на `https:`; в `cspDirectives` (`trusted-origins.ts`) переменная `PREVIEW_PORTS` больше не отключает `frame-ancestors 'none'`.
  - **S10**: в `src/env.ts` `AUTH_SEAL_SECRET` и `DB_CURSOR_SECRET` переведены на `secret` (`>= 32`), добавлены `keyId` и `keyRotationList` (`>= 32` на каждый старый ключ); в `vault.server.ts` порог поднят до `>= 32`; в `gateway.server.ts` и `app-storage.server.ts` добавлены потолки длины строки перед `Iron.unseal`.
  - **S11**: в `src/lib/db/cursor/codec.ts` токен кодируется как `<kidB64>.<payloadB64>.<macB64>`, а проверка `HMAC-SHA-256` выполняется по сырым байтам до `JSON.parse`.
  - **S12**: `vault.form.server.ts` и `upload-demo/vault/+page.server.ts` переведены на `localPath()`.
- **Тесты**: `security-hardening.test.ts` (`S9`, `S10 + S11 + S12`), `db-port-specific.test.ts`.

---

## 4. Расширенная архитектурная спецификация `S8`: полная изоляция демо-контента через функции регистрации

### 4.1. Диагноз текущего сцепления боевого и демонстрационного контуров

Сейчас демонстрационный стенд вплетён в боевой рантайм через **безусловные сайд-эффекты верхнего уровня при импорте модулей** и общие списки сборки:

1. **Модальные окна**: `(site)/+layout.svelte` безусловно делает `import '#content/storage-vault/modals.js'` (регистрируя демо-модалку `storage.vault` с роутом `/upload-demo/vault` в `globalScope`) и держит проверку `pathname.startsWith('/modals')` для вложенного `demoScope` из `(modals-demo)/registry.ts`.
2. **База данных и `dbHandle`**: `src/server/db.server.ts` безусловно включает ресурс `posts` (`public.demo_post`) и три демо-сида (`demo-post-seed-500`, `demo-user-seed-100`, `demo-profile-seed-100`) прямо в основной `schemaSpec` — засевая **100 синтетических аккаунтов `demo-*` в боевые таблицы `public.user_auth` и `public.user_profile`**. Одновременно `src/hooks.server.ts` передаёт в `dbHandle` фиктивного субъекта `DEMO_PRINCIPAL` (`{ id: 'demo-user', roles: ['user'] }`) для всех запросов процесса.
3. **Серверные формы (`*.form.server.ts`)**: `createComponentFormsHandle(import.meta.glob('./**/*.form.server.ts'))` в `src/hooks.server.ts` загружает все 13 серверных форм разом. Даже если скрыть ссылки на демо-страницы в UI, все 6 демо-форм (`upload-demo`, `storage-vault`, `db-demo`, `fields`, `signup`, `steps`) остаются зарегистрированными в `componentFormRegistry` и принимают POST/WebSocket-запросы на **любой** URL сайта!
4. **Серверные транспорты списков и демо-хранилище**: `src/hooks.server.ts` на верхнем уровне делает `import '#content/demo-catalog/posts/list.server.js'`, а `src/server/storage.server.ts` поднимает анонимный общий пул `/tmp/modals-kit-uploads` (`2 ГБ` диска + `128 МБ` RAM), открытый через `/api/files/[...path]`.
5. **Навигация, витрина и прогрев**: `NAV_ITEMS` в `src/routes/(site)/nav.ts` состоит из 10 демо-ссылок (рендерится в шапке, сайдбаре и футере), главная страница `(app)/+page.svelte` выводит карточки демо-стендов и dev-трассировку `/paginator`, а `vite.config.ts` прогревает демо-страницы в `warmup.clientFiles`.

Чтобы демо-контент включался **только** в демо-режиме и **на 100% выключался** без него (и в UI, и в реестрах памяти, и в БД, и по HTTP/WS), любая регистрация переводится с «сайд-эффекта при импорте файла» на **явные идемпотентные функции регистрации**, разделённые на два симметричных пакета: **`Core` (ядро приложения)** и **`Demo` (стенд)**.

---

### 4.2. Единый переключатель режима (`DEMO_MODE`)

1. **Переменная окружения в `src/env.ts` и `.env.example`**:
   - В `src/env.ts` добавляется схема `booleanToggle` (`1`/`true`/`yes` → `true`; `0`/`false`/`no` → `false`; пусто → `undefined`):
     ```ts
     DEMO_MODE: {
       schema: booleanToggle,
       description:
         'Режим демонстрационного стенда: включает демо-маршруты, демо-модалки, демо-формы, ' +
         'таблицу demo_post и тестовые сиды. По умолчанию включён в dev и ВЫКЛЮЧЕН в production-сборке.',
     }
     ```
2. **Серверный вычислитель `src/server/demo-mode.server.ts`**:
   ```ts
   import { DEV } from 'esm-env'
   import { DEMO_MODE, E2B_SANDBOX_ID } from '$app/env/private'

   /**
    * Единая точка правды демо-режима на сервере:
    * - явный `DEMO_MODE=true|false` всегда имеет приоритет (позволяет проверить чистый прод локально через `DEMO_MODE=0`);
    * - без явной переменной стенд активен только в `DEV` или в песочнице превью `E2B_SANDBOX_ID`;
    * - на любом боевом деплое по умолчанию строго `false`.
    */
   export function isDemoMode(): boolean {
     if (DEMO_MODE !== undefined) return DEMO_MODE
     return DEV || Boolean(E2B_SANDBOX_ID)
   }
   ```
3. **Передача флага в клиентское дерево через корневой SSR-лоадер (`src/routes/(site)/+layout.server.ts`)**:
   - `+layout.server.ts` возвращает `demoMode: isDemoMode()` рядом с `shell` и `user`.
   - Ни один клиентский компонент не гадает о режиме по `import.meta.env.DEV`: и SSR, и гидратация в браузере опираются на единый булев `data.demoMode`.

---

### 4.3. Полная карта разделения `Core` vs `Demo` по всем 7 плоскостям

| Плоскость | Боевое ядро (`Core` — включено всегда) | Демо-контур (`Demo` — только при `isDemoMode()`) |
|---|---|---|
| **1. Модалки** | `user.*` (`16` модалок в `content/user/modals.ts`), `storage.servers` (`content/storage-servers/modals.ts`) | `storage.vault` (`content/storage-vault/modals.ts`), `demoScope` в `(modals-demo)/registry.ts` (`card`, `flow-probe`, `fullpage`, `broken-route`, `locked`, `select`) |
| **2. БД: модели и SQL** | `auth`, `session`, `profile`, `userConfig`, `userBlock`, `cacheKv`, `storageFile`, `storageReservation`, `storageServer` + боевые индексы/сиды конфига (`user-config-*`, `user-block-*`) | Ресурс `posts` (`public.demo_post`) + SQL-сиды `demo-post-seed-500`, `demo-user-seed-100`, `demo-profile-seed-100` |
| **3. Контекст `dbHandle`** | Подтверждённый субъект из `auth(event).actor()` (`{ id, roles: permissions }`) либо гость `{ roles: [] }` | `DEMO_PRINCIPAL` (`{ id: 'demo-user', roles: ['user'] }`) — строго для запросов демо-маршрута `/db-demo` |
| **4. Формы (`*.form.server.ts`)** | `7` модулей: `seed`, `profile`, `profile-delete`, `user-config`, `block`, `block-delete`, `storage-server` | `6` модулей: `storage-vault/vault`, `db-demo/db`, `fields/fields`, `form/signup`, `steps/steps`, `upload-demo/upload` |
| **5. Серверные транспорты и RAM-пулы** | `captureUpstreamFetch()`, `app-storage.server.ts` (`/api/storage/*`), `admin-bootstrap.server.ts` | `posts/list.server.ts` (`registerServerTransport`), `storage.server.ts` (`/tmp/modals-kit-uploads`), `form/queue.server.ts`, кэши `rickmorty` и `shikimori` |
| **6. Маршруты и API** | `/`, `/auth`, `/user/*`, `/users/*`, `/blocks/*`, `/storage-servers`, `/schema`, `/api/storage/[...path]` | UI: `/modals`, `/paginator`, `/form`, `/fields`, `/steps`, `/db-demo`, `/upload-demo`, `/upload-demo/vault`, `/cards/*`, `/cycle`, `/spike`; API: `/api/files/*`, `/api/form-upload` (для демо-форм), `/api/db-posts`, `/api/rickmorty/*`, `/api/shikimori/*` |
| **7. Навигация и упоминания в UI** | Боевые пункты меню (`CORE_NAV_ITEMS`), чистый экран `/` без демо-карточек, шапка с профилем/темой | `DEMO_NAV_ITEMS` в `NavSlot` / `SidebarNav` / `SiteFooter`, витрина `<DemoShowcase />` на `/`, `foreignNames = 'skip'` для `/modals` |

---

### 4.4. Проектирование функций регистрации по каждой подсистеме

#### А. Упаковка модальных окон: `registerCoreModals()` и `registerDemoModals()`

Вместо вызова `registerModal(...)` на верхнем уровне при импорте модуля каждый домен экспортирует идемпотентную функцию регистрации с защитой от повторного вызова в рамках среды (SSR / браузер):

```ts
// src/content/user/modals.ts
let registered = false
export function registerUserModals(scope = globalScope): void {
  if (registered) return
  registered = true
  registerModal({ scope, name: 'user.auth', component: lazy(() => import('./ui/AuthModal.svelte')), route: userAuthRoute.href, size: { width: 420, height: 480 } })
  // ... остальные боевые модалки пользователя
}

// src/content/storage-servers/modals.ts
let registered = false
export function registerStorageServersModals(scope = globalScope): void {
  if (registered) return
  registered = true
  registerModal({ scope, name: STORAGE_SERVERS_MODAL, component: lazy(() => import('./ui/StorageServersModal.svelte')), route: storageServersRoute.href, size: { width: 680, height: 640 } })
}

// src/content/storage-vault/modals.ts (ДЕМО)
let registered = false
export function registerStorageVaultDemoModal(scope = globalScope): void {
  if (registered) return
  registered = true
  registerModal({ scope, name: STORAGE_VAULT_MODAL, component: lazy(() => import('./ui/StorageVaultModal.svelte')), route: STORAGE_VAULT_ROUTE, size: { width: 540, height: 640 } })
}

// src/routes/(site)/(modals-demo)/registry.ts (ДЕМО)
let demoScopeRegistered = false
export function registerModalsDemoScope(): ModalScope {
  if (!demoScopeRegistered) {
    demoScopeRegistered = true
    registerModal({ scope: demoScope, name: 'card', /* ... */ })
    // ... flow-probe, fullpage, broken-route, locked, select
  }
  return demoScope
}
```

Два агрегирующих фасада собирают ядро и демо раздельно:
- `src/content/modals.core.ts` → `export function registerCoreModals(): void` (вызывает `registerUserModals()` и `registerStorageServersModals()`).
- `src/content/demo/modals.demo.ts` → `export function registerDemoModals(): void` (вызывает `registerStorageVaultDemoModal()`; а `registerModalsDemoScope()` вызывается внутри `(modals-demo)/+layout.svelte`, куда без `DEMO_MODE` запрос даже не доходит).

В `src/routes/(site)/+layout.svelte`:
```ts
registerCoreModals()

// Ленивая подгрузка демо-модалок: в чистом проде чанк демо-реестра даже не исполняется!
let demoModalsReady = $state(false)
$effect.pre(() => {
  if (data.demoMode && !demoModalsReady) {
    void import('#content/demo/modals.demo.js').then((m) => {
      m.registerDemoModals()
      demoModalsReady = true
    })
  }
})

const foreignNames = $derived(
  data.demoMode && visibleAddress().url.pathname.startsWith('/modals')
    ? ('skip' as const)
    : ('error' as const),
)
```
**Эффект при `DEMO_MODE = false`**: в `globalScope` зарегистрированы только боевые модалки; переход по `?modal=storage.vault` или `?modal=card` не находит модалку в реестре и не открывает демо-компоненты.

---

#### Б. Упаковка моделей БД и SQL-миграций/сидов: `coreSchemaSlice()` и `demoSchemaSlice()`

В `src/server/db.server.ts` описание схемы перестаёт быть монолитным литералом и собирается функцией `buildSchemaSpec({ demo: boolean })`:

```ts
export function coreSchemaSlice(): SchemaSpec {
  return {
    resources: [
      auth,
      session,
      profile,
      userConfig,
      userBlock,
      cacheKv,
      storageFile,
      storageReservation,
      storageServer,
    ],
    sql: [
      { id: 'user-config-uq-global', text: '...' },
      { id: 'user-config-uq-user', text: '...' },
      { id: 'user-config-seed-visibility', text: '...' },
      { id: 'user-config-seed-iplock', text: '...' },
      { id: 'user-block-ix-target', text: '...' },
      { id: 'user-block-backfill-v2', text: '...' },
    ],
  }
}

export function demoSchemaSlice(): SchemaSpec {
  return {
    resources: [posts],
    sql: [
      { id: 'demo-post-seed-500', text: '...' },
      { id: 'demo-user-seed-100', text: '...' },
      { id: 'demo-profile-seed-100', text: '...' },
    ],
  }
}

export function buildAppSchemaSpec(opts: { demo: boolean }): SchemaSpec {
  const core = coreSchemaSlice()
  if (!opts.demo) return core
  const demo = demoSchemaSlice()
  return {
    resources: [...core.resources, ...demo.resources],
    sql: [...core.sql, ...demo.sql],
  }
}
```

Одновременно в `src/hooks.server.ts` исправляется резолвер субъекта `dbHandle`:
- При обычной работе приложения `principal: async (event) => { const a = await auth(event).actor(); return a.ok ? { id: a.value.id, roles: [...a.value.permissions] } : { roles: [] } }`.
- Фиктивный `DEMO_PRINCIPAL` подставляется **только** если `isDemoMode() === true`, пользователь — гость и запрос идёт к демо-витрине (`/db-demo` или `/api/db-posts`).

**Эффект при `DEMO_MODE = false`**:
- В боевой базе `DATABASE_URL` таблица `public.demo_post` не создаётся и не запрашивается (`db.resource(posts)` отвергается слоем `#lib/db` как незарегистрированный ресурс).
- В `public.user_auth` и `public.user_profile` создаётся ровно один первый администратор (`ensureSeedAdmin`) и `0` синтетических `demo-*` аккаунтов.

---

#### В. Упаковка серверных форм компонентов: `registerCoreComponentForms()` и `registerDemoComponentForms()`

Главный изъян глобального `import.meta.glob('./**/*.form.server.ts')` — смешение боевых и демо-обработчиков в одном слепом сканировании дерева. Изоляция строится в два шага:

1. **Явные функции регистрации вместо голого сайд-эффекта в каждом модуле формы**:
   Каждый модуль экспортирует именованную функцию `register*Form(registry = componentFormRegistry)`:
   ```ts
   // Пример боевой формы: src/content/user/ui/seed-form/seed.form.server.ts
   export function registerSeedForm(registry = componentFormRegistry): void {
     registerComponentForm({ description: seedForm, throttle: seedAuthThrottle, /* ... */ }, registry)
   }

   // Пример демо-формы: src/routes/(site)/(app)/upload-demo/upload.form.server.ts
   export function registerUploadDemoForms(registry = componentFormRegistry): void {
     registerComponentForm({ description: uploadDemoForm, /* ... */ }, registry)
     // ... остальные демо-формы стенда выгрузки
   }
   ```
2. **Два явных серверных агрегатора регистрации (`src/server/forms-core.server.ts` и `src/server/forms-demo.server.ts`)**:
   ```ts
   // src/server/forms-core.server.ts
   let coreRegistered = false
   export async function registerCoreComponentForms(): Promise<void> {
     if (coreRegistered) return
     coreRegistered = true
     registerSeedForm()
     registerProfileForm()
     registerProfileDeleteForm()
     registerUserConfigForm()
     registerBlockForm()
     registerBlockDeleteForm()
     registerStorageServerForm()
   }

   // src/server/forms-demo.server.ts
   let demoRegistered = false
   export async function registerDemoComponentForms(): Promise<void> {
     if (demoRegistered) return
     demoRegistered = true
     const [vault, dbDemo, fields, signup, steps, upload] = await Promise.all([
       import('#content/storage-vault/vault.form.server.js'),
       import('../routes/(site)/(app)/db-demo/db.form.server.js'),
       import('../routes/(site)/(app)/fields/fields.form.server.js'),
       import('../routes/(site)/(app)/form/signup.form.server.js'),
       import('../routes/(site)/(app)/steps/steps.form.server.js'),
       import('../routes/(site)/(app)/upload-demo/upload.form.server.js'),
     ])
     vault.registerStorageVaultForms()
     dbDemo.registerDbDemoForms()
     fields.registerFieldsDemoForms()
     signup.registerSignupDemoForm()
     steps.registerStepsDemoForm()
     upload.registerUploadDemoForms()
   }
   ```
3. **Условная загрузка в `createComponentFormsHandle` и `ws-session.server.ts`**:
   Вместо безусловного глоба передаётся загрузчик:
   ```ts
   async function ensureActiveComponentForms(): Promise<void> {
     await registerCoreComponentForms()
     if (isDemoMode()) {
       await registerDemoComponentForms()
     }
   }
   ```
   При `isDemoMode() === false` модули демо-форм (и завязанный на них `src/server/storage.server.ts` с `/tmp/modals-kit-uploads`) **даже не импортируются в память Node/Worker-процесса**, а любой POST или WebSocket `init` с `formId` демо-формы отклоняется как неизвестная форма (`404 Unknown component form` в WS / пропуск в HTTP).

---

#### Г. Упаковка серверных транспортов списков и фоновых демо-служб: `registerDemoServerRuntime()`

В `src/hooks.server.ts` убирается статический импорт `import '#content/demo-catalog/posts/list.server.js'`. Вместо него создаётся серверная точка входа демо-рантайма `src/server/demo-runtime.server.ts`:

```ts
let demoRuntimeStarted = false

export async function registerDemoServerRuntime(): Promise<void> {
  if (demoRuntimeStarted) return
  demoRuntimeStarted = true
  const { registerDemoPostsServerTransport } = await import(
    '#content/demo-catalog/posts/list.server.js'
  )
  registerDemoPostsServerTransport()
}
```
В `src/hooks.server.ts`:
```ts
export const init: ServerInit = async () => {
  captureUpstreamFetch()
  if (isDemoMode()) {
    await registerDemoServerRuntime()
  }
}
```

---

#### Д. Жёсткое перекрытие демо-маршрутов и демо-API: `demoRoutesGuardHandle`

Даже при наличии файлов маршрутов в дереве `src/routes/**` единый серверный хук и layout-гейт гарантируют, что при `isDemoMode() === false` ни один демо-роут и ни один демо-API не выполнит свой `load`, `actions` или `+server.ts`:

```ts
// src/server/demo-routes.ts (чистый список префиксов — общий для сервера, навигации и тестов)
export const DEMO_UI_PREFIXES = [
  '/modals',
  '/paginator',
  '/form',
  '/fields',
  '/steps',
  '/db-demo',
  '/upload-demo',
  '/cards',
  '/cycle',
  '/spike',
] as const

export const DEMO_API_PREFIXES = [
  '/api/files',
  '/api/db-posts',
  '/api/rickmorty',
  '/api/shikimori',
] as const

export function isDemoPathname(pathname: string): boolean {
  return [...DEMO_UI_PREFIXES, ...DEMO_API_PREFIXES].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
```

*(Примечание: `/api/form-upload` обслуживает потоковый `wss://`-транспорт как для демо, так и для любых боевых форм с файлами; поскольку при `DEMO_MODE = false` в `componentFormRegistry` зарегистрированы только боевые формы, `/api/form-upload` остаётся активным для боевых форм с проверкой их `authorize` и отвергает любые демо `formId` с `404`.)*

В `src/hooks.server.ts` **первым** после `securityHeadersHandle` ставится `demoRoutesGuardHandle`:
```ts
export const demoRoutesGuardHandle: Handle = async ({ event, resolve }) => {
  if (!isDemoMode() && isDemoPathname(event.url.pathname)) {
    if (event.url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    error(404, 'Страница не найдена')
  }
  return resolve(event)
}
```
Дополнительно все демо-страницы группируются под route-группой `(demo)` (`src/routes/(site)/(app)/(demo)/+layout.server.ts`), чей `load` дублирует проверку `if (!isDemoMode()) error(404)` (эшелонированная защита на случай прямого вызова `load` во внутренних саб-запросах SvelteKit).

---

#### Е. Изоляция навигации, ссылок, футера и главной страницы (`getNavItems`, `<DemoShowcase />`)

Чтобы при выключенном `DEMO_MODE` в интерфейсе не оставалось ни одной битой ссылки, кнопки или упоминания демо-разделов:

1. **Навигация (`src/routes/(site)/nav.ts`)**:
   ```ts
   export const CORE_NAV_ITEMS: readonly NavItem[] = [
     // Боевые разделы приложения (например Главная; админские разделы уже живут в UserMenu по правам)
   ]

   export const DEMO_NAV_ITEMS: readonly NavItem[] = [
     { to: '/modals', label: 'Модалки' },
     { to: '/paginator', label: 'Пагинатор' },
     { to: '/form', label: 'Форма' },
     { to: '/fields', label: 'Поля' },
     { to: '/steps', label: 'Шаги' },
     { to: '/db-demo', label: 'База данных' },
     { to: '/upload-demo', label: 'Загрузка файлов' },
     { to: '/cycle', label: 'Cycle' },
     { to: '/spike', label: 'Spike' },
     { to: cardRoute.href({ id: '1' }), label: 'Карточка #1', match: cardRoute.is },
   ]

   export function getNavItems(opts: { demo: boolean }): readonly NavItem[] {
     return opts.demo ? [...CORE_NAV_ITEMS, ...DEMO_NAV_ITEMS] : CORE_NAV_ITEMS
   }
   ```
   В `src/routes/(site)/+layout.svelte` вычисляется `const navItems = $derived(getNavItems({ demo: data.demoMode }))` и передаётся одновременно в `NavSlot`, `SidebarNav` и `SiteFooter` (при пустом `navItems` слоты навигации рендерятся пустыми без лишних разделителей).
2. **Главная страница (`src/routes/(site)/(app)/+page.svelte`)**:
   - Карточки `demos` и dev-кнопка `/paginator?selectTrace=1` выносятся в изолированный компонент `src/content/demo/ui/DemoShowcase.svelte`.
   - На `+page.svelte` при `data.demoMode === true` монтируется `<DemoShowcase />`, а при `data.demoMode === false` — чистый рабочий экран приложения без единого упоминания демо-стендов.
3. **Развязка прогрева Vite (`vite.config.ts`)**:
   - Демо-пути в `server.warmup.clientFiles` (`modals/+page.svelte`, `cycle/+page.svelte`, `spike/+page.svelte`, `cards/[id]/+page.svelte`) добавляются только если `getEnv('DEMO_MODE') !== '0' && getEnv('DEMO_MODE') !== 'false'`.

---

#### Ж. Архитектурный страж `tooling/demo-isolation.test.mjs` (гарантия невозврата связности)

Чтобы ни один будущий коммит случайно не вернул прямую зависимость ядра от демо-модулей, в `npm run test:guard` добавляются три автоматических правила:

1. **Запрет импорта демо из боевого ядра**: файлы из `src/content/user/**`, `src/content/storage-servers/**`, `src/components/{ui,form,modals,paginator,shell,steps}/**`, `src/server/{db,app-storage,admin-bootstrap,form-security,safe-storage-fetch,client-ip}.server.ts` не имеют права импортировать ничего из `src/content/demo-catalog/**`, `src/content/storage-vault/**`, `src/components/demo/**` и демо-веток `src/routes/**` (связь допускается только в точке сборки регистрации `demoSchemaSlice` / `registerDemo*`).
2. **Запрет голых top-level регистраций в демо-модулях**: все вызовы `registerModal`, `registerComponentForm` и `registerServerTransport` внутри демо-дерева обязаны находиться внутри экспортируемой функции `register*`, а не на верхнем уровне файла.
3. **Запрет жёстких демо-ссылок в боевом UI**: ни один `.svelte`/`.ts` файл вне демо-зон не содержит строковых литералов из `DEMO_UI_PREFIXES` и `DEMO_API_PREFIXES`.

---

#### З. Невозможность включения из клиентского JS и нулевая буферизация файлов в RAM (**реализовано в транспортном контуре**)

1. **Иммунитет к подмене на клиенте**:
   - `DEMO_MODE` читается только на сервере (`$app/env/private`). Мутация `data.demoMode = true` в браузерном DevTools или ручной вызов `fetch` / `WebSocket` не включает ни один серверный обработчик: при `DEMO_MODE = false` демо-формы (`upload_bundle`, `fields-record`, `signup`) отсутствуют в серверном `componentFormRegistry()`, а `src/server/storage.server.ts` с `memoryDriver` (`memory`, `shard_a`, `shard_b`) вообще не загружается в процесс.
   - По `wss://` (`/api/form-upload`) клиент не может самовольно прислать бинарные сегменты: сервер принимает только текстовый Кадр `0` (`init`), проверяет регистрацию формы, `formToken` и `preAuthorize`/`authorize`, и при отказе закрывает сокет при `0` прочитанных файловых байтах.
2. **Жёсткая отсечка буферизации HTTP `POST` в RAM (`src/hooks/component-form/server.server.ts`, `authorize.server.ts`, `profile.form.server.ts`)**:
   - **Динамический потолок по реестру и по форме**: `readBoundedOnce` больше не буферизует до глобальных `2 МБ` (`FORM_BODY_LIMIT`) вслепую — потолок сужается до `resolveRegistryHttpCap` / `resolveFormHttpBudget` (`<= 64 КиБ` для текстовых форм без `budget`, `<= 32 КиБ` для сквозных экшенов маршрутов и `36 КиБ` для `user-profile` в `PROFILE_HTTP_BUDGET`).
   - **Потоковая отсечка на первых `32 КиБ` и запрет файловой контрабанды**: во время чтения префикса `readBoundedOnce` на лету опознаёт `__form_id` и проверяет `Content-Disposition ... filename="..."`. Любая попытка прислать непустой файл без зарегистрированной файловой формы, в выключенную демо-форму или в чисто текстовую форму мгновенно прерывает поток (`reader.cancel()`) на первом же чанке без сборки `FormData`/`File` в ОЗУ.
   - **Нулевой гейт `preAuthorize(event)` до чтения тела**: при `x-form-id` (и сразу после распознавания префикса без `x-form-id`) выполняется `runPreAuthorize` по кукам/заголовкам запроса. Анонимный запрос в `user-profile` отменяется на `0` прочитанных байтах тела (`reader.cancel()`), а проверка прав на чужой `subject` вынесена в `authorize(event, raw)` до `imageCheck`/`avatar-spec` и до обращения к хранилищу.
   - **Сквозной стрим в боевое хранилище**: боевой `appStorage` (`src/server/app-storage.server.ts`) не имеет `memoryDriver` и пишет входящие потоки напрямую в S3/WebDAV.

---

### 4.5. Пошаговый порядок внедрения `S8` (без поломки текущих тестов)

1. Ввести `DEMO_MODE` в `src/env.ts` + `.env.example`, создать `src/server/demo-mode.server.ts` и `src/server/demo-routes.ts`, пробросить `demoMode` из `src/routes/(site)/+layout.server.ts`.
2. Обернуть все модалки в `registerCoreModals()` и `registerDemoModals()`, переключить `src/routes/(site)/+layout.svelte` и `(modals-demo)/+layout.svelte`.
3. Разделить `src/server/db.server.ts` на `coreSchemaSlice()` и `demoSchemaSlice()` (`buildAppSchemaSpec({ demo: isDemoMode() })`) и переключить `dbHandle` в `src/hooks.server.ts` с безусловного `DEMO_PRINCIPAL` на реального актора `auth(event)`.
4. Перевести все 13 `*.form.server.ts` и `posts/list.server.ts` на явные функции `register*`, собрать `registerCoreComponentForms()` / `registerDemoComponentForms()` и `registerDemoServerRuntime()`.
5. Подключить `demoRoutesGuardHandle` в `src/hooks.server.ts`, перевести `nav.ts` на `getNavItems({ demo })`, вынести карточки главной страницы в `<DemoShowcase />` и добавить страж `tooling/demo-isolation.test.mjs` + интеграционный тест двух режимов (`DEMO_MODE=true` vs `DEMO_MODE=false`).
