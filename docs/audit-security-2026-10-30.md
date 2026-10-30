# Комплексный аудит безопасности системы (`2026-10-30`)

Статус: **аудит зафиксирован** (исправления — по решению и приоритетам владельца).
Методика: сквозной статический анализ исходников всех слоёв (`src/env.ts`, `vite.config.ts`, `src/hooks.server.ts`, `src/server/*`, `src/content/user/*`, `src/content/storage-*`, `src/hooks/*`, `src/lib/*`, `src/routes/*`) со сверкой защитных паттернов по открытому коду через GitHub Code Search API (`sveltejs/kit`, `actualbudget/actual`, `kanwas-ai/kanwas`, `pacoyang/pi-glean`, `seanmorley15/AdventureLog`, `SveltyCMS/SveltyCMS`, `PetalNet/Nexus`, `TiszL/pixel-kingdom-wars`, `LF-Decentralized-Trust-labs/identity-bot`, `nuxt/nuxt`, `workos/workos-node`).

---

## 1. Уже действующие сильные стороны защиты

Перед перечнем уязвимостей зафиксируем механизмы, которые уже реализованы качественно и подтверждены проверкой кода:

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
   - все HTTP-вызовы внутри `s3.ts` и `webdav.ts` выполняются с `redirect: 'manual'`, что предотвращает утечку заголовков `Authorization` и `301`/`302`-редиректы на внутренние адреса.
4. **Защита от Open Redirect (`src/lib/address/core.ts`)**:
   - `localPath` парсит путь через `new URL(raw, 'http://local.invalid')` и сверяет `origin`, блокируя не только `https://` и `//`, но и обратные слэши `/\evil.com`.
5. **Шифрование секретов хранения (`iron-webcrypto` + `AES-256-GCM`)**:
   - `storage_server.sealed_config` запечатывается с поддержкой ротации ключей;
   - слоты `CookieVault` шифруются `AES-256-GCM` со связанными данными `AAD = "modals-kit:dv:v1:<scope>:<id>"` и привязкой ключа куки к серверному `AUTH_SEAL_SECRET`.

---

## 2. Сводная матрица обнаруженных проблем

| ID | Уровень | Узел | Суть риска |
|---|---|---|---|
| **S1** | **High** | `AuthWidget.svelte`, `SeedForm.svelte`, `seed.form.server.ts`, `auth.ts` | Приватный Ed25519-ключ (`secret`) отправляется по сети открытым текстом даже с JS, не помечен `sensitive`, а `proveSeed` допускает вызов без `signature` |
| **S2** | **High** | `trusted-origins.ts`, `form-security.server.ts` | `localOrigins()` всегда непуст: ветка `sameOrigin` мертва (ломает zero-config прод), `localhost:5173/5174` доверен в проде, а wildcard `*` использует `[^/]+` |
| **S3** | **High** | `app-storage.server.ts`, `storage.server.ts`, `vault.form.server.ts` | SSRF через DNS Rebinding: проверка DNS работает только при сохранении слота (`probe`), а рантайм S3/WebDAV ходит сырым `fetch` без закрепления IP в сокете |
| **S4** | **High** | `gateway.server.ts`, `cookie-vault/vault.server.ts` | У кук `auth_sid`, `auth_tmp` и `dv_key` жёстко стоит `secure: false` в обычном режиме (`SameSite=Lax`), позволяя перехват и подмену кук по HTTP |
| **S5** | **Medium** | `user/schema.ts`, `user/auth.ts` | `jti`, `version` и `subnet_salt` открыты на чтение (`read: () => true`), а `subnetHash` считается без серверного секрета (полный перебор IPv4 `/24` за `< 1 с`) |
| **S6** | **Medium** | `gateway.server.ts`, `storage.server.ts` | `subnetOf` читает самый левый элемент `X-Forwarded-For` без валидации IP вместо платформенного `event.getClientAddress()` |
| **S7** | **Medium** | `auth.ts`, `db-schema.server.ts`, `ws-session.server.ts` | Повторное использование `challenge` в окне TTL, отсутствие rate-limit на вход / `/schema` / пробы хранилища и отсутствие потолка на `user_session` и `activeUploadSessions` |
| **S8** | **Medium** | `db.server.ts`, `hooks.server.ts`, `storage.server.ts` | Безусловное заселение боевой БД демо-аккаунтами (`demo-user-seed-100`) и общий неаутентифицированный пул `/upload-demo` + `/api/files` |
| **S9** | **Low** | `hooks.server.ts`, `trusted-origins.ts` | Отсутствуют глобальные `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`; `PREVIEW_PORTS` снимает `frame-ancestors 'none'` |
| **S10** | **Low** | `src/env.ts`, `gateway.server.ts`, `vault.server.ts` | `AUTH_SEAL_SECRET` и `DB_CURSOR_SECRET` валидируются как `text` вместо `secret` (`>= 32`), нет проверки длины ключей в `*_OLD_KEYS` и длины куки до `Iron.unseal` |
| **S11** | **Low** | `src/lib/db/cursor/codec.ts` | В `createCursorCodec.decode` выполняется `JSON.parse` тела токена до проверки `HMAC-SHA256` |
| **S12** | **Low** | `vault.form.server.ts`, `upload-demo/vault/+page.server.ts` | Ручная проверка `startsWith('/') && !startsWith('//')` вместо единого `localPath()` |

---

## 3. Подробный разбор и рекомендации по защите

### S1 [High] — Передача приватного ключа `secret` на сервер при включённом JS и опциональная подпись в `proveSeed`

- **Где**:
  - `src/content/user/ui/AuthWidget.svelte:82–92`
  - `src/content/user/ui/seed-form/SeedForm.svelte:105–116`
  - `src/content/user/ui/seed-form/seed.form.server.ts:54–86`
  - `src/content/user/ui/seed-form/form.ts:34`
  - `src/content/user/auth.ts:165–176`
- **Механика**:
  1. Документация модуля (`keys.ts`) фиксирует инвариант: приватный ключ `secret` не покидает браузер при включённом JS, а сервер принимает публичный `seed` и проверяет Ed25519-подпись. Фактически `prepare(fd)` в `AuthWidget.svelte` и `SeedForm.svelte` оставляет в `fd.set('seed', typed)` **приватный `secret`**, а `seed.form.server.ts` вычисляет `seedOf(values.seed)` уже на сервере. В результате бессменный мастер-ключ аккаунта передаётся в теле каждого POST-запроса (попадая в зону видимости реверс-прокси, WAF/APM-логгеров и SSR-снапшота `continuation` при ошибке валидации, так как поле объявлено обычным `field.text` без `sensitive: true`).
  2. Одновременно в ядре `proveSeed` (`auth.ts:173`) стоит условие `if (args.signature !== undefined && !(await ports.crypto.verify(...)))`. Если `signature` не передана, криптографическая проверка полностью пропускается. Поскольку публичный `seed` в `user_auth` читается всеми ролями чтения аккаунтов (`read: () => true`), любая прямая передача публичного `seed` в `u.login` / `u.restoreDeleted` без обязательной `signature` приведёт к захвату любого аккаунта по его публичному идентификатору.
- **Сверка по GitHub Code Search (`@noble/ed25519` challenge-response: `TiszL/pixel-kingdom-wars`, `LF-Decentralized-Trust-labs/identity-bot`)**:
  В эталонных схемах Ed25519-аутентификации серверное ядро принимает **исключительно** публичный ключ и непустую подпись канонического сообщения (`challenge` + доменный контекст), никогда не делая `signature` опциональной.
- **Как закрыть**:
  1. В `proveSeed` (`auth.ts`) сделать `signature` **строго обязательной** (`if (!args.signature) return { code: 'auth.signature', path: 'signature' }`).
  2. В `AuthWidget.svelte` и `SeedForm.svelte` внутри `prepare(fd)` вычислять `pub = await seedOf(typed)` и `sig = await sign(challenge, typed)`, класть в форму `public_seed = pub`, `signature = sig` и **очищать** поле приватного секрета (`fd.set('seed', '')`) до отправки по сети.
  3. Поддержку режима без JS изолировать строго на границе `seed.form.server.ts`: только если `public_seed` и `signature` пусты, а пришёл `seed` (приватный ключ из нативного HTML POST), сервер в оперативной памяти вычисляет `seedOf` + `sign(challenge, rawSecret)` и передаёт в `u.login` уже пару `{ seed: pub, challenge, signature }`.
  4. Пометить поле `seed` в `seedForm` как чувствительное (`sensitive: true` / тип пароля со скрытием и без эха значения в `continuation`).

---

### S2 [High] — Мёртвая ветка `sameOrigin`, доверие `localhost` в продакшене и широкий wildcard в `originGuard`

- **Где**:
  - `src/server/trusted-origins.ts:34–56`
  - `src/server/form-security.server.ts:25–53`
  - `src/lib/form/server.ts:73–86`
- **Механика**:
  1. `localOrigins()` безусловно возвращает `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:5174`, `http://127.0.0.1:5174` независимо от режима сборки. Поэтому в `form-security.server.ts:51` массив `exact` всегда имеет длину `>= 4`, а fallback `sameOrigin(ctx)` («сравниваем с собственным адресом запроса, как фреймворк») **никогда не вызывается**. При деплое без `KIT_TRUSTED_ORIGINS` запросы с собственного боевого домена получают `403 origin.rejected`.
  2. Включение `http://localhost:5173,5174` в `csrf.trustedOrigins` и `originGuard` продакшена означает, что любой локальный dev-сервер, сторонний контейнер или ненадёжный скрипт на порту `5173`/`5174` рабочей станции администратора проходит Origin-проверку боевого приложения (особенно опасно при `AUTH_COOKIE_SAMESITE=none` и при апгрейде `GET /api/form-upload` в WebSocket).
  3. Преобразование wildcard `.replace(/\*/g, '[^/]+')` в `trusted-origins.ts:53` пропускает символ `@` (`https://trusted.com@evil.com`, если строка не нормализована через `new URL(origin).origin`) и небезопасные шаблоны без разделительной точки.
- **Сверка по GitHub Code Search (`sveltejs/kit` `csrf.ts`)**:
  В SvelteKit 3 встроенная проверка CSRF **всегда** пропускает совпадение `origin === url.origin` и сверяет `csrf.trustedOrigins` только как дополнительные внешние источники.
- **Как закрыть**:
  1. В `originGuard` всегда пропускать совпадение нормализованного `new URL(origin).origin === new URL(ctx.request.url).origin` (и для `Referer` при отсутствии `Origin`, если режим это допускает).
  2. Подмешивать `localOrigins()` только при `dev === true` или явно выставленном `E2B_SANDBOX_ID` / непустом `PREVIEW_PORTS`.
  3. Для wildcard-записей разбирать `origin` через `new URL(origin).origin` и заменять `*` на строгий сегмент хоста `[a-z0-9-]+` (только на границе поддомена `*.` или `port-*`).

---

### S3 [High] — SSRF через DNS Rebinding в рантайме хранилища S3 / WebDAV

- **Где**:
  - `src/server/app-storage.server.ts:253–266`
  - `src/server/storage.server.ts:163–179`
  - `src/content/storage-vault/vault.form.server.ts:174–211`
- **Механика**:
  1. Проверка IP-адресов через DNS (`createBoundedSafeFetch`) подключена **только** во время сохранения конфигурации сервера (`probeStorageVaultEntry`). В рантайме как боевой пул (`resolveAppStorage`), так и открытый для анонимных посетителей демо-сейф (`resolveRequestStorage` на `/upload-demo`) создают драйверы по `url: entry.url` с обычным `globalThis.fetch`.
  2. Атакующий регистрирует в `CookieVault` свой домен с `TTL = 1 с`, во время `probe` отдаёт публичный IP с валидным WebDAV-ответом, получает подписанную куку `dv_storage_*`, после чего меняет DNS-запись домена на `169.254.169.254` (cloud IMDS), `127.0.0.1` или внутренний адрес кластера `10.x.x.x` — все последующие вызовы `put` / `stat` / `lazy` обращаются напрямую во внутреннюю сеть без DNS-фильтра.
  3. Даже внутри `createBoundedSafeFetch` предварительный `dns.lookup(host)` не закрепляет IP для последующего `baseFetch(input)`: стек `undici` делает повторный системный запрос DNS, оставляя окно для TOCTOU-перепривязки.
- **Сверка по GitHub Code Search (`actualbudget/actual`, `kanwas-ai/kanwas`, `pacoyang/pi-glean`)**:
  В Node-приложениях защита от DNS Rebinding на базе `fetch` (`undici`) строится через кастомный `new Agent({ connect: { lookup } })`, который проверяет все IP внутри самого `lookup`-колбэка сокета и возвращает сокету уже проверенный адрес без второго DNS-обращения.
- **Как закрыть**:
  1. Вынести SSRF-безопасный `fetch` в общий серверный модуль (например, `src/server/safe-storage-fetch.server.ts`) и передавать его через `fetchImpl` при создании `s3Driver` / `webdavDriver` **во всех рантайм-пулах** (`resolveAppStorage` и `resolveRequestStorage`).
  2. На Node/Vercel использовать `undici` `Agent` с проверкой приватных/link-local/IMDS-адресов прямо в `connect.lookup` (а в среде без `undici` — повторную проверку на каждый запрос с коротким кэшем проверенного отказа).

---

### S4 [High] — Отсутствие флага `Secure` у сессионных кук на HTTPS в продакшене

- **Где**:
  - `src/content/user/gateway.server.ts:61–64`
  - `src/hooks/cookie-vault/vault.server.ts:34–54`
- **Механика**:
  Когда `AUTH_COOKIE_SAMESITE` не равен `'none'` (штатный боевой режим `SameSite=Lax`), опции кук жёстко содержат `secure: false`. В результате `auth_sid` (долгоживущий токен устройства), `auth_tmp` и мастер-ключ куки-сейфа `dv_key` выдаются браузеру **без флага `Secure`**. При любом нешифрованном запросе `http://` к тому же домену (до кеширования HSTS, который сейчас также не выставляется) куки уходят открытым текстом по сети и уязвимы к перехвату и атаке cookie tossing с соседних HTTP-поддоменов.
- **Сверка по GitHub Code Search (`seanmorley15/AdventureLog` `session-cookies.ts`)**:
  Стандартный кросс-окруженческий приём в SvelteKit — вычислять `secure: event.url.protocol === 'https:'` на уровне конкретного запроса: на `http://localhost` и локальном HTTP флаг автоматически `false`, а на любом HTTPS-деплое (включая работу за прокси с `X-Forwarded-Proto: https`) — строго `true`.
- **Как закрыть**:
  Заменить статическую константу `COOKIE_BASE` / `COOKIE_OPTS` на функцию `cookieOptions(event.url)` с `secure: AUTH_COOKIE_SAMESITE === 'none' || event.url.protocol === 'https:'`.

---

### S5 [Medium] — Чтение чувствительных полей `jti`, `version`, `subnet_salt` и обратимость хеша подсети IPv4 `/24`

- **Где**:
  - `src/content/user/schema.ts:142, 188, 200`
  - `src/content/user/auth.ts:78–83`
- **Механика**:
  1. В `user.session.v1` поля `jti` и `version` сейчас имеют `read: () => true` (закрытие за `read: ['server']` уже заложено в план перевода сессий на прямую модель).
  2. В `user.auth.v1` поле `subnet_salt` также открыто на чтение (`read: () => true`), а хеш подсети вычисляется как обычный `SHA-256("${salt}:${subnet}")` без серверного секрета. Во всём интернете насчитывается всего $2^{24} = 16\,777\,216$ подсетей IPv4 `/24`: при получении `subnet_salt` и `subnet_hash` (через чтение модели или утечку резервной копии БД) точная подсеть `/24` любого пользователя перебирается менее чем за `0,5 с` на одном ядре CPU.
- **Как закрыть**:
  1. Закрыть `jti` и `version` в `user.session.v1` и `subnet_salt` в `user.auth.v1` маской `read: ['server']`.
  2. Вычислять `subnetHash` через `HMAC-SHA-256` с серверным пеппером (производным от `AUTH_SEAL_SECRET`, с поддержкой `AUTH_SEAL_OLD_KEYS` или отдельным HKDF-контекстом): тогда без серверного секрета перебор подсетей по дампу БД невозможен.

---

### S6 [Medium] — Доверие первому элементу `X-Forwarded-For` без валидации IP

- **Где**:
  - `src/content/user/gateway.server.ts:593–602`
  - `src/server/storage.server.ts:126`
- **Механика**:
  `subnetOf` берёт `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()` и режет строку по `.` или `:` без проверки валидности IP (`isIP`). Если перед приложением стоит прокси, дописывающий адрес в конец `X-Forwarded-For`, клиент может сам прислать заголовок `X-Forwarded-For: 1.2.3.4` (или мусорную строку), подменяя свою подсеть в истории входов и обходя режим `sessionRecreate = 'strict'`.
- **Сверка по GitHub Code Search (`SveltyCMS/SveltyCMS`, `PetalNet/Nexus`)**:
  В SvelteKit источник клиентского адреса — `event.getClientAddress()` (адаптеры Vercel, Cloudflare и Node с `ADDRESS_HEADER` / `XFF_DEPTH` берут достоверный адрес края платформы).
- **Как закрыть**:
  Передавать в `auth(event)` адрес из безопасно обёрнутого `event.getClientAddress()`, нормализовать IPv4-mapped IPv6 (`::ffff:a.b.c.d`) и проверять корректность адреса через `isIP` перед выделением `/24` или `/48`.

---

### S7 [Medium] — Повтор `challenge`, отсутствие Rate Limiting и потолков активных сессий

- **Где**:
  - `src/content/user/auth.ts:137–176, 232–255`
  - `src/hooks/db-schema.server.ts:59–99`
  - `src/hooks/component-form/ws-session.server.ts:133–138`
- **Механика**:
  1. Stateless `challenge` остаётся валидным весь `challengeTtlSec` без одноразового гашения: повторная отправка перехваченного пакета плодит параллельные строки в `public.user_session`, а лимита числа живых сессий на один `auth_id` нет.
  2. На чувствительных точках (`seedForm` `login`/`restore`/`confirm`/`challenge`, ввод `DB_ADMIN_TOKEN` на `/schema`, сетевые пробы `probeStorageVaultEntry`) нет ограничителя частоты по IP / ключу в `sharedStore`.
  3. Карта припаркованных при обрыве WebSocket-выгрузок `activeUploadSessions` не имеет глобального и по-адресного потолка: злоумышленник может массово открывать и обрывать соединения с кодом `1006`, удерживая сотни незакрытых потоков и временных файлов в течение `60 с`.
- **Как закрыть**:
  1. Гасить `challenge.n` в `sharedStore` (`SET NX` / проверка наличия ключа на `challengeTtlSec`), делая каждый challenge строго одноразовым.
  2. Ограничить число живых сессий на аккаунт (например, `50` с мягким отзывом самой старой по `last_seen_at`) и размер `activeUploadSessions` (например, до `128` глобально и `4` на клиентский IP).
  3. Добавить лёгкий rate-limiter поверх `sharedStore` (`#lib/cache`) для `/user/auth`, `/schema` и сохранения серверов хранилища.

---

### S8 [Medium] — Автоматическое заселение демо-данных и открытый демо-стенд загрузки в продакшене

- **Где**:
  - `src/server/db.server.ts:116–143`
  - `src/hooks.server.ts:27`
  - `src/server/storage.server.ts:31–54`
  - `src/routes/(site)/(app)/upload-demo/*`, `src/routes/api/files/[...path]/+server.ts`
- **Механика**:
  1. SQL-шаги `demo-post-seed-500`, `demo-user-seed-100` и `demo-profile-seed-100` включены в основной `schemaSpec` и выполняются автоматически при первом подключении даже к внешней боевой базе `DATABASE_URL`, создавая 100 синтетических строк в таблице безопасности `public.user_auth`.
  2. Маршруты `/upload-demo` и `/api/files/[...path]` используют общие для всего процесса `UPLOAD_ROOT_DIR` (`2 ГБ`) и `sharedMemoryDriver` (`128 МБ` ОЗУ) без авторизации: на публичном деплое любой посетитель может исчерпать квоту памяти/диска или удалить файлы другого посетителя стенда.
- **Как закрыть**:
  Вынести демо-сиды `schemaSpec.sql` и запись в публичные демо-слоты за явный флаг окружения `DEMO_MODE` (включён по умолчанию в `dev`/превью и выключен на боевом `DATABASE_URL` без флага).

---

### S9–S12 [Low / Hardening] — Заголовки ответов, валидация env-ключей, курсоры и редиректы

1. **S9 — Базовые защитные HTTP-заголовки и `frame-ancestors` (`src/hooks.server.ts`, `src/server/trusted-origins.ts:127`)**:
   - В `hooks.server.ts` стоит выставлять на все ответы по умолчанию `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` и (при `https:`) `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
   - В `cspDirectives` условие `Boolean(opts.get('PREVIEW_PORTS'))` полностью убирает `frame-ancestors 'none'`. Снятие защиты от clickjacking следует привязывать только к `dev`, `E2B_SANDBOX_ID` или явному `AUTH_COOKIE_SAMESITE === 'none'`.
2. **S10 — Строгая схема секретов в `src/env.ts` и потолок длины куки (`src/env.ts:163–195`, `src/content/user/gateway.server.ts:560`)**:
   - Перевести `AUTH_SEAL_SECRET` и `DB_CURSOR_SECRET` в `src/env.ts` со схемы `text` на `secret` (`>= 32` символов) и добавить валидатор пар `id:secret` для `AUTH_SEAL_OLD_KEYS` и `DB_CURSOR_OLD_KEYS` (каждый секрет `>= 32` символов), убрав расхождение с `cookie-vault` (`>= 16`).
   - В `authPorts().seal.unseal` отсекать строки длиннее `4096` символов до вызова `Iron.unseal` (по аналогии с проверкой `token.length <= 8192` в `createCursorCodec`).
3. **S11 — Проверка подписи до `JSON.parse` в `createCursorCodec` (`src/lib/db/cursor/codec.ts:109–139`)**:
   - Сейчас `decode` сначала делает `JSON.parse` тела курсора, чтобы прочитать `kid`, и лишь затем вызывает `crypto.subtle.verify`. Кодирование формата `kid.payload.mac` позволяет проверять `HMAC-SHA256` по сырым байтам до любого `JSON.parse`.
4. **S12 — Единая нормализация локальных адресов (`src/content/storage-vault/vault.form.server.ts:163`, `src/routes/(site)/(app)/upload-demo/vault/+page.server.ts:6`)**:
   - Заменить ручные проверки `startsWith('/') && !startsWith('//')` на вызов штатного `localPath()` из `#lib/address/index.js`.
