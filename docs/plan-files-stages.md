# План: `lib/storage` — поэтапная разработка

Заказ владельца. Этапы задаются и утверждаются по мере продвижения: все ответы и
архитектурные решения сохраняются внутри этапа; код в `src/` пишется **только по
явной команде владельца** после фиксации спецификации этапа.

---

## ПРОЦЕДУРА (для продолжения после обрыва / сжатия контекста)

1. **Пять жёстких правил (`<hard_rules>`):**
   - перед правками проверять `git rev-parse --is-inside-work-tree` и
     `git status --porcelain`;
   - коммитить локально сразу после зелёного гейта при любых изменениях вне `/tmp`;
   - не заявлять «сделано / работает» без заполненного `<evidence_block>`;
   - любое пропущенное требование называть вслух в ответе и в `SKIPPED`;
   - после вопросов / корректировок владельца — стоп: ответить и ждать решения,
     не трогая код реализации.
2. **VCS и среда:**
   - репозиторий `/home/user/projects/modals-kit`, ветка `img` (база `693f9a3`),
     `origin` не трогаем, **пуш не делаем** без явной команды;
   - перед первым кодовым шагом поднять Node.js `>= 22.17` в `/usr/local/bin` и
     выполнить `npm ci` (`--no-liftoff` для PGlite);
   - `/home/user/uploads/github-token.txt` и учётные данные WebDAV никогда не
     печатать в вывод, не логировать и не коммитить; правило о кратких статусах
     только между крупными этапами сохранено в
     `/home/user/uploads/coding-agent-prompt.md` (`7debb53`).
3. **Точка остановки (`STOPPED AT`):** Этапы **`S0` + `S0-S3` + `S0.5` + `S1` + `S2` + `S3`**
   отправлены в `origin/img` (`e12d465`, `21bb85c`, `3133071`; слияние с параллельной веткой — `e323922`),
   и поверх них локально завершены этап **`S4`** (`a58e598`) и двухпроходный аудит по GitHub Code Search
   **`S5a` + `S5b`** (первый проход по эталонным пакетам + второй проход по свежим релизам октября 2026
   менее популярных авторов: `LeLibrary v5.7.1`, `wicaby v0.14.2`, `object-storage`, `lucid-cms`,
   `sharedworld v0.5.4`).

---

## Состояние этапов по коммитам (обновлено 2026-10-29)

| Этап | Содержание | Состояние | Коммиты |
|---|---|---|---|
| **1a. Базовый мультисерверный S3-этап `#lib/storage` (`S0` + `S0-S3` + `S0.5`)** | Мультисерверный `createStorage` с `defineStorageLedger` (`memoryLedger` + `jsonLedger`), `s3Driver` (`aws4fetch`, `s3://` DSN, Multipart Upload `>= 5 МиБ`, `Range GET`), `storage.probe(server)`, универсальный `#hooks/cookie-vault` + `<CookieVault>` и кнопка в `DemoPanel` (модалка + роут, `0` ключей в `.env`/БД) | **Выполнено и отправлено в `origin/img`** | `4ab27b0`..`e12d465` |
| **1b. Шифрование, лимитеры, `store`/`tech`/`state`, нарезка `split`, `stageToDisk` и `clone` (`S1` + `S2`)** | `crypto.ts` (64 КиБ `AES-256-GCM` + $O(1)$ `Range` + `key: null`), `bandwidth.ts` (`rate` + `rate: 0`), `concurrency.ts` (`reject`/`queue`/`preempt` + `429` + `concurrency: 0`), `store.ts` (`defineStorageStore`, `memoryStore`, `tech`/`meta` с деградацией в `console.error`), `state.ts`, планировщик нарезки `split` по `fileBytes`/`storageBytes` с `allowSplit`, `localSpool` (`stageToDisk: true`), `clone()` | **Выполнено и отправлено в `origin/img`** | `21bb85c` |
| **1c. Адаптер `webdav` и документация (`S3`)** | Серверный адаптер `webdav.ts` (`MKCOL`/`PROPFIND`/`HEAD`/`Range GET`/стриминговый `PUT`/`DELETE`/`COPY`, `basePath`, `readOnly`, DSN `webdav://`), поддержка `webdav://` в куки-сейфе, `src/lib/storage/README.md`, живая проверка на Облаке Mail.ru | **Выполнено и отправлено в `origin/img`** | `3133071` |
| **1d. Потоковый `upload(request)`, `has`/`list`, `cooldownMs` и связка `#hooks/storage-db` (`S4`)** | Потоковый `storage.upload(request, options)` (`@remix-run/form-data-parser/future`, `accept`, `maxFiles`, `maxFileSize`, атомарный откат), `storage.has()` и `storage.list()`, карантин упавших серверов `cooldownMs` с авто-фейловером записи и чтения реплик, переходник `src/hooks/storage-db.ts` (`pgStorageLedger` на `#lib/db` + `cacheStorageStore` на `#lib/cache`) | **Выполнено и проверено локально** | `a58e598` |
| **1e. Двухпроходный аудит и закалка краевых случаев по GitHub Code Search (`S5a` + `S5b`)** | Lookahead одиночного `PUT` для потоков неизвестной длины `<= 5 MiB`, проверка `<Error>` в `200 OK` `CompleteMultipartUpload` и нативный `CopyObject` (`x-amz-copy-source`), `redirect: 'manual'`, проверка `multistatus` XML и `HREF-ESCAPE` в WebDAV, обход утечки `Blob#stream()` в Node `< 24.20` (`nodejs/node#63574`), снятие скрытого потолка `2 MiB` и пустых `<input type="file">` в `upload()`, честная обработка `ENOENT` в `local.ts`, проверка усечения хвоста `crypto.ts` и межинстансный `pg_advisory_xact_lock` в `pgStorageLedger` | **Выполнено и проверено локально** | `5b76fda` + локальный коммит `S5b` |

---

# Этап 1. Спецификация независимой библиотеки `#lib/storage`

## 1.1. Зафиксированные решения владельца

1. **Полная автономность пакета `src/lib/storage`:**
   - `lib/storage` **не импортирует** ни `svelte` / `@sveltejs/kit`, ни соседние
     пакеты `#lib/db` и `#lib/cache` (переносится в React / Next.js / Hono / CLI
     обычным копированием папки).
   - Стриминг и HTTP опираются на готовые пакеты **`@remix-run/lazy-file`**,
     **`@remix-run/response`**, **`@remix-run/fs`** и
     **`@remix-run/form-data-parser`** (MIT, 0 привязки к фреймворкам).
2. **Учёт места, резервирование и манифесты кусков — через собственный контракт `ledger` (`defineStorageLedger`):**
   - Само приложение владеет правдой о занятом и зарезервированном месте на
     каждом сервере, не полагаясь на кривые/отсутствующие `quota`-методы облаков.
   - Конечным источником данных для `ledger` может быть что угодно: **в самой
     `lib/storage` сразу даём готовую реализацию на JSON-файле (`jsonLedger`)** и
     в памяти (`memoryLedger` для тестов), а позже в слое приложения (`src/hooks/`)
     к тому же `defineStorageLedger` одним файлом подключается `lib/db`.
3. **Опциональный кэш-стор (`defineStorageStore`) и тех. параметры (`tech` / `meta`) с мягкой деградацией:**
   - `ip`, `cdnUrl` и другая техническая информация передаются из приложения, а не
     ищутся библиотекой в заголовках/окружении.
   - Если `store` или нужное поле `tech`/`meta` не переданы — библиотека штатно
     работает без них; если же включён параметр, требующий их наличия (например
     `scope: 'ip'` без `ip`, `cdn: true` без `cdnUrl`, `statTtlMs` без `store`) —
     **параметр игнорируется, а в `console.error` пишется понятная ошибка**.
4. **Один `createStorage` со словарём серверов, настройки — у каждого сервера свои:**
   - `limits: { storageBytes, fileBytes }` — **обязательны** в конфиге каждого
     сервера.
   - `allowSplit?: boolean` — опция сервера, позволяющая запретить хранение на
     нём нарезанных кусков (`false` → только цельные файлы).
   - `key`, `rate`, `concurrency` задаются в конфиге конкретного сервера: не
     переданы — этот сервер работает без шифрования, без лимита скорости и без
     лимита потоков (например капризное облако без шифрования или резервный
     сервер с `rate: 128 * 1024`, когда «лес горит»).
   - В конкретном вызове (`get`, `put`, `serve`, `copy`, `move`, `clone`,
     `upload`) можно переопределить `key` / `rate` / `concurrency` либо принудительно
     снять настройку сервера через **`key: null`**, **`rate: 0`**,
     **`concurrency: 0`**.
5. **Правила нарезки файлов (`split`), резервирования и `stageToDisk`:**
   - Нарезка включается **только если известен конечный вес файла (`size`) И
     источник поддерживает догрузку / чтение со смещения** (`File` / `Blob` /
     `LazyFile` либо включено сохранение на диск до отправки `stageToDisk: true`).
   - В функции можно явно указать `splitServers: [...]`, иначе берутся серверы из
     общего пула записи, у которых `allowSplit !== false`.
   - До отправки первого байта заранее рассчитывается, какие серверы сколько байт
     примут (с точным учётом оверхеда шифрования `AES-256-GCM` по 64-КБ блокам),
     и этот объём **атомарно резервируется в `ledger`**.
   - Для конкретного вызова можно включить **`stageToDisk: true`**: входящий поток
     сначала сохраняется во временный файл на локальном диске (давая точный `size`
     и возможность догрузки кусков при сбое), а после отправки на серверы удаляется.
6. **Стенд для живой проверки:** личное Облако Mail.ru по WebDAV (с предохранителями
   `readOnly` и `basePath`).

---

## 1.2. Архитектура пакета и точки входа (`src/lib/storage/entrypoints.json`)

```json
{
  "//": "`index.js` — ядро `createStorage`, контракты `defineStorageLedger` и `defineStorageStore`, шифрование, лимитеры скорости и потоков, типы и ошибки (0 node:fs, 0 фреймворков); `s3.js` — потоковый S3-драйвер (`aws4fetch`, SigV4 streaming PUT + Multipart Upload + Range GET для Backblaze B2 / Cloudflare R2 / AWS S3); `webdav.js` — сервер WebDAV на чистом fetch; `local.js` — локальный диск сервера (`@remix-run/fs`), `jsonLedger` и дисковый спул `stageToDisk`; `state.js` — необязательный коллектор телеметрии.",
  "entrypoints": ["index.js", "s3.js", "webdav.js", "local.js", "state.js"]
}
```
*(Почему `jsonLedger` и спул диска лежат в `local.js`: им нужен `node:fs`, поэтому
основной вход `index.js` и `webdav.js` остаются на 100% чистыми и запускаются даже
в Cloudflare Workers / браузере / Edge без Node-полифиллов!)*

---

## 1.3. Финальный контракт API `#lib/storage`

### 1. Контракт учёта и резервирования (`defineStorageLedger`) + `jsonLedger`

```ts
/** Одна физическая часть логического файла на конкретном сервере. */
export interface StoredPart {
  readonly index: number
  readonly server: string
  readonly path: string          // физический путь на этом сервере
  readonly plainBytes: number    // полезный вес открытых байт в этой части
  readonly storedBytes: number   // реальный вес на сервере (с заголовком и тегами шифрования)
  readonly encrypted: boolean
  readonly etag?: string
}

/** Запись логического файла в реестре (цельного из 1 части или нарезанного на N серверов). */
export interface StoredFileRecord {
  readonly path: string          // логический путь файла в приложении
  readonly name: string
  readonly size: number          // полный открытый вес файла
  readonly storedBytes: number   // суммарно занято на серверах
  readonly type: string
  readonly lastModified: number
  readonly createdAt: number
  readonly parts: readonly StoredPart[]
}

/** Заявка на бронь места на одном сервере. */
export interface ServerAllocation {
  readonly server: string
  readonly bytes: number         // сколько физических байт нужно забронировать
  readonly maxStorageBytes: number // потолок этого сервера из конфига для атомарной проверки
}

export interface LedgerReservation {
  readonly id: string
  readonly allocations: readonly ServerAllocation[]
  readonly expiresAt: number
}

export interface ServerUsageSnapshot {
  readonly usedBytes: number
  readonly reservedBytes: number
  readonly filesCount: number
  readonly partsCount: number
}

export interface StorageLedgerSpec {
  /** Атомарно проверить остаток (used + reserved + bytes <= maxStorageBytes) и зарезервировать место. */
  reserve(input: {
    readonly id: string
    readonly allocations: readonly ServerAllocation[]
    readonly ttlMs: number
  }): LedgerReservation | null | Promise<LedgerReservation | null>

  /** Перевести бронь в постоянную запись файла (обновляет usedBytes и снимает reservedBytes; если по path лежал старый файл — возвращает его старые части на удаление). */
  commit(input: {
    readonly reservationId: string
    readonly file: StoredFileRecord
  }): { readonly replaced?: StoredFileRecord } | Promise<{ readonly replaced?: StoredFileRecord }>

  /** Отменить бронь и вернуть зарезервированные байты (при сбое или AbortSignal). */
  release(reservationId: string): void | Promise<void>

  /** Снять протухшие брони (от упавших процессов) и вернуть их список. */
  sweepExpired?(now?: number): number | Promise<number>

  getFile(path: string): StoredFileRecord | null | Promise<StoredFileRecord | null>
  deleteFile(path: string): StoredFileRecord | null | Promise<StoredFileRecord | null>
  listFiles(options?: { prefix?: string; limit?: number; cursor?: string }):
    | { entries: readonly StoredFileRecord[]; cursor?: string }
    | Promise<{ entries: readonly StoredFileRecord[]; cursor?: string }>

  /** Снимок занятого и зарезервированного места по серверам для планировщика и отчёта. */
  usage(servers: readonly string[]): Record<string, ServerUsageSnapshot> | Promise<Record<string, ServerUsageSnapshot>>
}

export function defineStorageLedger(spec: StorageLedgerSpec): AdaptedStorageLedger

/** В памяти процесса (для юнит-тестов и одноразовых скриптов). */
export function memoryLedger(): AdaptedStorageLedger

/** В `#lib/storage/local.js`: надёжный учёт в JSON-файле с in-process мьютексом и атомарной записью tmp -> rename! */
export function jsonLedger(options: { readonly filePath: string }): AdaptedStorageLedger
```

---

### 2. Опциональный кэш-стор (`defineStorageStore`) и технические параметры (`tech`)

```ts
export interface StorageStoreSpec {
  get<T = unknown>(key: string): T | undefined | Promise<T | undefined>
  set<T = unknown>(key: string, value: T, options?: { ttlMs?: number }): void | Promise<void>
  delete(key: string): void | Promise<void>
  add?<T = unknown>(key: string, value: T, options: { ttlMs: number }): boolean | Promise<boolean>
  incr?(key: string, options: { ttlMs: number; by?: number }): number | Promise<number>
}

export function defineStorageStore(spec: StorageStoreSpec): AdaptedStorageStore

export interface StorageRequestMeta {
  readonly ip?: string
  readonly clientId?: string
  readonly requestId?: string
  readonly [extra: string]: unknown
}

export interface StorageTechConfig {
  readonly publicOrigin?: string
  readonly resolveMeta?: (request: Request) => StorageRequestMeta | Promise<StorageRequestMeta>
}
```

---

### 3. Конфиг каждого сервера и сборка `createStorage`

```ts
export interface ServerLimits {
  readonly storageBytes: number  // ОБЯЗАТЕЛЬНО: общий объём хранилища на этом сервере
  readonly fileBytes: number     // ОБЯЗАТЕЛЬНО: макс. вес одного физического файла на сервере
}

export interface ServerPolicyConfig {
  readonly limits: ServerLimits
  /** Разрешено ли хранить здесь куски нарезанных файлов (по умолчанию true). */
  readonly allowSplit?: boolean
  /** Блокировка записи/удаления (для безопасных тестов на живом личном облаке). */
  readonly readOnly?: boolean

  /** Опционально: не переданы -> без шифрования, без лимита скорости и потоков! */
  readonly key?: Uint8Array | string | null
  readonly rate?: number | BandwidthLimiter
  readonly concurrency?: number | ConcurrencyConfig

  readonly cdnUrl?: string
  readonly statTtlMs?: number
}

export interface StorageConfig<TServers extends Record<string, StorageServer>> {
  readonly servers: TServers
  readonly ledger: AdaptedStorageLedger

  /** Пул и стратегия выбора серверов на запись (по умолчанию все пишущие серверы в порядке объявления). */
  readonly default?: keyof TServers & string
  readonly writePool?: readonly (keyof TServers & string)[]
  readonly writeStrategy?: 'priority' | 'most-free' | 'round-robin'
  readonly cooldownMs?: number
  readonly reservationTtlMs?: number // по умолчанию 1 час

  /** Дисковый спул для вызовов со stageToDisk: true (из `#lib/storage/local.js`, например localSpool('./data/tmp')). */
  readonly spool?: StorageSpool

  /** Опционально: нет — работаем без них; при включении зависимых опций — игнор + console.error. */
  readonly store?: AdaptedStorageStore
  readonly tech?: StorageTechConfig
  readonly state?: StorageStateListener
}
```

---

### 4. Методы экземпляра `Storage`

```ts
export interface CallOverrides<S extends string = string> {
  readonly signal?: AbortSignal
  readonly meta?: StorageRequestMeta
  /** undefined -> настройка сервера; своё -> переопределить; null / 0 -> снять! */
  readonly key?: Uint8Array | string | null
  readonly rate?: number | BandwidthLimiter
  readonly concurrency?: number | ConcurrencyConfig
}

export interface PutOptions<S extends string = string> extends CallOverrides<S> {
  /** Записать строго на конкретный сервер целиком (без ротации). */
  readonly server?: S
  /** Разрешить нарезку на части и (опционально) ограничить список серверов под нарезку. */
  readonly split?: boolean          // по умолчанию true, когда известен size и источник resumable
  readonly splitServers?: readonly S[]
  /** Сначала сохранить входящий поток на диск до отправки на серверы (даёт точный size и догрузку). */
  readonly stageToDisk?: boolean

  readonly size?: number
  readonly type?: string
  readonly lastModified?: number
  readonly overwrite?: boolean
}

export interface Storage<S extends string = string> {
  get(path: string, options?: CallOverrides<S> & { server?: S | readonly S[] }): Promise<LazyFile | null>
  lazy(path: string, meta: Omit<StorageStat, 'key' | 'name'> & { name?: string; server?: S }, options?: CallOverrides<S>): LazyFile
  has(path: string, options?: CallOverrides<S> & { server?: S }): Promise<boolean>
  stat(path: string, options?: CallOverrides<S> & { server?: S }): Promise<StoredFileRecord | null>

  put(path: string, body: StorageBody, options?: PutOptions<S>): Promise<StoredFileRecord>
  upload(request: Request, options: UploadOptions<S>): Promise<UploadResult>
  remove(path: string, options?: CallOverrides<S> & { server?: S }): Promise<void>
  list(options?: StorageListOptions & { server?: S }): Promise<StorageListResult>

  serve(target: string | File | StoredFileRecord, request: Request, options?: ServeOptions<S>): Promise<Response>

  copy(path: string, options: CopyOptions<S>): Promise<StoredFileRecord>
  move(path: string, options: CopyOptions<S>): Promise<StoredFileRecord>
  clone(options: CloneOptions<S>): Promise<CloneReport<S>>

  /** Сводный отчёт по всем серверам из ledger + статуса здоровья: лимиты, занято, в брони, остаток, файлы и части. */
  report(): Promise<StorageReport<S>>
}
```

---

## 1.4. Внутренний чек-лист реализации Этапа 1 (по команде владельца)

Чтобы код шёл чистыми, проверяемыми коммитами (правило 2 — коммит после каждого
зелёного гейта):

| Шаг | Содержание | Гейты и тесты |
|---|---|---|
| **S0. Среда и зависимости** | Поставить Node.js `>= 22.17` в `/usr/local/bin`, выполнить `npm ci`, установить `@remix-run/lazy-file`, `@remix-run/response`, `@remix-run/fs`, `@remix-run/form-data-parser`, `aws4fetch` | `node -v`, `node tooling/public-api.mjs`, `npm run check` |
| **S0-S3 (Базовый этап S3 на 2 хостах)** | Базовый мультисерверный `createStorage` с `defineStorageLedger` (`memoryLedger` + `jsonLedger`), обязательными `limits: { storageBytes, fileBytes }` серверов и атомарной бронью `reserve`/`commit`/`release`; потоковый драйвер `s3.ts` (`aws4fetch`: zero-buffer SigV4 `PUT` + S3 Multipart Upload `>= 5 МиБ` с `AbortMultipartUpload` + `Range GET`); потоковый межсервисный перенос `copy`/`move` (`B2 ↔ R2 ↔ local` без буферизации в RAM); `report()`; перевод `/upload-demo` на каноничную `DemoPanel` (`demo-schema.ts`) | Контрактные и живые тесты на 2 хостах S3 (Backblaze B2 + Cloudflare R2), гонки резервирования `ledger`, скан `schemas.test.ts`, `public-api`, `core-purity`, `layer-guard`, `svelte-check`, `vitest`, `vite build`, Playwright E2E |
| **S1. Контракты `store`, лимитеры и потоковое шифрование** | `store.ts`, `bandwidth.ts`, `concurrency.ts` (`preempt`/`reject`/`queue` + деградация `console.error`), `crypto.ts` (64-КБ `AES-256-GCM` со сдвигом `Range` и точным расчётом `encryptedSize`), `state.ts` | `vitest`: шифрование/расшифровка произвольных `Range`-срезов поперёк 64-КБ границ, `rate`/`concurrency` и `console.error` при отсутствии `store`/`ip` |
| **S2. Мультисерверный движок `createStorage`: планировщик нарезки, ротация, `stageToDisk`, `serve`, `upload`, `copy`/`move`/`clone`, `report`** | Склейка частей с разных серверов в единый `LazyFile`, `serve` на `@remix-run/response` (`200`/`206`/`304`/`416` + UTF-8 `Content-Disposition`), приём от юзера `upload`, дисковый спул `localSpool`, `copy`/`move`/`clone` (с быстрым байт-в-байт путём при одинаковом `key`) | `vitest`: нарезка файла по `fileBytes` и остатку `storageBytes` между несколькими серверами, запрет нарезки при `allowSplit: false` и на не-resumable потоке без `stageToDisk`, откат брони при сбое, `206 Range` поперёк стыка двух серверов, `clone` |
| **S3. Серверные адаптеры `local` и `webdav` + документация и стражи** | `local.ts` (`@remix-run/fs` + `jsonLedger` + `localSpool`), `webdav.ts` (`PROPFIND`, `HEAD`, `GET` с `Range`, `PUT` со стримом, `DELETE`, `COPY`, `basePath`, `readOnly`), `entrypoints.json` + добавление `src/lib/storage` в `tooling/core-purity.mjs`, подробный `src/lib/storage/README.md` | Контрактные тесты с локальным HTTP WebDAV-сервером + полный прогон `public-api`, `core-purity`, `layer-guard`, `svelte-check`, `vitest`, `vite build` (+ живой тест на Облаке Mail.ru при передаче кредов) |
| **S4–S6. Потоковый `upload()`, `#hooks/storage-db.ts`, аудит безопасности S3/WebDAV, куки-сейф и полный стенд `/upload-demo`** | **Выполнено (Этап 1 закрыт полностью):** `storage.upload()` на `@remix-run/form-data-parser/future`; `pgStorageLedger` (`pg_advisory_xact_lock` + `clock_timestamp()`) и `cacheStorageStore` в `#hooks/storage-db.ts`; `serve(string \| File \| StoredFileRecord)` с `Range 206` поперёк зашифрованных шардов, `put({ overwrite: false })` (`StorageOverwriteError`), `tech.publicOrigin`, `stat(path, { server })`, общий `createConcurrencyGate`; нативный S3 `CopyObject`, `redirect: 'manual'`, защита `HREF-ESCAPE` и `<multistatus` в WebDAV; куки-сейф `storage.vault` с внутренним скроллом модалки; полный стенд `/upload-demo` (`split_demo` `shard_a + shard_b`, `stageToDisk`, `copy`/`move`/`clone`, `probe`, телеметрия `state.js`, инспектор `HEAD` + `Range 206` + `304` + `concurrency 429`) и развёрнутая статья `src/lib/storage/README.md` | Все контрактные, интеграционные и живые проверки (B2 + R2 + Mail.ru WebDAV + Vitest + 7 наборов стражей `tooling/` + `npm run build` + Chromium Playwright E2E) пройдены |
