# `#lib/storage` — мультисерверное потоковое хранилище файлов

Автономный пакет хранения, шифрования, маршрутизации и HTTP-раздачи файлов без буферизации целиком в оперативной памяти.

Ядро пакета (`#lib/storage/index.js`, `#lib/storage/s3.js`, `#lib/storage/webdav.js`, `#lib/storage/state.js`) не импортирует `svelte`, `@sveltejs/kit`, `#lib/db`, `#lib/cache` и `node:fs` (проверяется стражами `tooling/core-purity.mjs` и `tooling/public-api.mjs`) и одинаково исполняется в **Node.js 22+**, **Bun**, **Cloudflare Workers** и **Vercel Functions**. Файловые адаптеры диска вынесены в отдельный вход `#lib/storage/local.js`, а связка с PostgreSQL и `#lib/cache` — в переходник приложения `#hooks/storage-db.js`.

```
Входы             index.js · s3.js · webdav.js · local.js · state.js (entrypoints.json)
Память            0 целых файлов в ОЗУ: сквозные ReadableStream + ленивые срезы StreamFile
Драйверы          memoryDriver · localDriver (.part → rename) · s3Driver (aws4fetch) · webdavDriver (fetch)
Маршрутизация     пул серверов · priority / most-free / round-robin · карантин cooldownMs
Нарезка (split)   раскладка крупных файлов по нескольким серверам + склейка Range 206 по шву
Шифрование        потоковый AES-256-GCM кадрами 64 КиБ (HKDF-SHA-256, защита от усечения, O(1) Range)
Трафик            шейпер скорости rate (Б/с) · семафоры потоков concurrency (reject / queue / preempt)
Квоты (ledger)    атомарная бронь reserve → commit / release (memoryLedger · jsonLedger · pgStorageLedger)
Приём и отдача    multipart-парсер storage.upload() и HTTP-раздача storage.serve() (200/206/304/416 + CSP)
```

Содержание:
· [1. Точки входа и зависимости](#1-точки-входа-и-зависимости)
· [2. Composition root и устройство конфигурации](#2-composition-root-и-устройство-конфигурации)
· [3. Драйверы серверов и строковые DSN](#3-драйверы-серверов-и-строковые-dsn)
· [4. Запись (`put`), потоковый `upload` и нарезка (`split`)](#4-запись-put-потоковый-upload-и-нарезка-split)
· [5. Чтение (`lazy`, `get`, `stat`) и HTTP-раздача (`serve`)](#5-чтение-lazy-get-stat-и-http-раздача-serve)
· [6. Потоковое шифрование `AES-256-GCM`](#6-потоковое-шифрование-aes-256-gcm)
· [7. Шейпер скорости (`rate`) и семафоры потоков (`concurrency`)](#7-шейпер-скорости-rate-и-семафоры-потоков-concurrency)
· [8. Реестр квот (`ledger`), кэш `store` и связка с PostgreSQL](#8-реестр-квот-ledger-кэш-store-и-связка-с-postgresql)
· [9. Межсерверные операции (`copy`, `move`, `clone`) и телеметрия](#9-межсерверные-операции-copy-move-clone-и-телеметрия)
· [10. Ошибки, инварианты безопасности и проверка](#10-ошибки-инварианты-безопасности-и-проверка)

---

## 1. Точки входа и зависимости

Снаружи `src/lib/storage/` разрешены только входы, перечисленные в [`entrypoints.json`](./entrypoints.json):

| Спецификатор | Среда | Экспортируемые примитивы |
|---|---|---|
| `#lib/storage/index.js` | любая Web-среда (`0` `node:*`) | `createStorage`, `StreamFile`, `memoryDriver`, `defineStorageLedger`, `memoryLedger`, `defineStorageStore`, `memoryStore`, `createBandwidthLimiter`, `createConcurrencyGate`, `encryptedSize`, `decryptedSize`, `normalizeStoragePath`, `matchesUploadAccept`, `sanitizeUploadFileName`, классы ошибок |
| `#lib/storage/s3.js` | любая Web-среда (`fetch` + Web Crypto) | `s3Driver`, `parseS3Url`, `formatS3Url`, `maskS3Url` |
| `#lib/storage/webdav.js` | любая Web-среда (`fetch`) | `webdavDriver`, `parseWebdavUrl`, `formatWebdavUrl`, `maskWebdavUrl` |
| `#lib/storage/local.js` | Node.js / Bun (`node:fs`) | `localDriver`, `jsonLedger`, `localSpool` |
| `#lib/storage/state.js` | любая Web-среда (`0` зависимостей) | `createStorageState` и типы событий/снимков телеметрии |

Внешние пакеты — компактные автономные MIT Web-библиотеки без привязки к фреймворкам:

| Зависимость | Назначение в `#lib/storage` |
|---|---|
| `@remix-run/lazy-file` | Базовый контракт ленивого `File` со срезами `.slice(start, end)` без загрузки файла в память (`StreamFile`) |
| `@remix-run/response` | HTTP-раздача `200 OK` / `206 Partial Content` / `304 Not Modified` / `416 Range Not Satisfiable`, `ETag`, `Last-Modified` и `HEAD` |
| `@remix-run/fs` | Ленивое открытие локальных файлов по дескриптору в `localDriver` и `localSpool` |
| `@remix-run/form-data-parser` (`/future`) | Потоковый разбор входящего `multipart/form-data` в `storage.upload()` без буферизации тела запроса |
| `aws4fetch` | Подпись AWS Signature V4 для потокового `PUT`, Multipart Upload, `CopyObject` и `Range GET` в `s3Driver` |

---

## 2. Composition root и устройство конфигурации

Как и у `#lib/db` и `#lib/cache`, библиотека не читает `process.env` сама: сборка серверов, реестра квот и лимитеров живёт в серверных модулях композиции приложения — [`src/server/app-storage.server.ts`](../../server/app-storage.server.ts) (боевой пул серверов из таблицы `storage_server` под `STORAGE_ACL` + раздача `/api/storage/[...path]`) и [`src/server/storage.server.ts`](../../server/storage.server.ts) (изолированный куки-сейф демо-стенда `/upload-demo` + раздача `/api/files/[...path]`).

```ts
import { createStorage, createConcurrencyGate } from '#lib/storage/index.js'
import { localDriver, localSpool } from '#lib/storage/local.js'
import { s3Driver } from '#lib/storage/s3.js'
import { webdavDriver } from '#lib/storage/webdav.js'
import { createStorageState } from '#lib/storage/state.js'
import { cacheStorageStore, pgStorageLedger } from '#hooks/storage-db.js'
import { localStore } from './cache.server.js'
import { db } from './db.server.js'

const MB = 1024 * 1024
const GB = 1024 * MB

export const storageState = createStorageState()
const downloadGate = createConcurrencyGate('archive', {
  maxConcurrent: 4,
  scope: 'ip',
  mode: 'reject',
})

export const storage = createStorage({
  default: 'local',
  writePool: ['r2', 'mailru', 'local'],
  writeStrategy: 'most-free',      // 'priority' | 'most-free' | 'round-robin'
  cooldownMs: 30_000,              // карантин сервера после сетевого/5xx сбоя
  reservationTtlMs: 3_600_000,     // автоистечение зависших броней места (1 ч)

  ledger: pgStorageLedger(db),
  store: cacheStorageStore(localStore.scope('storage:stat', { max: 1024 })),
  spool: localSpool({ rootDir: '.data/uploads/_spool' }),
  state: storageState.onEvent,

  tech: {
    publicOrigin: 'https://cdn.example.com',
    resolveMeta: (req) => ({
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      clientId: req.headers.get('x-client-id') ?? undefined,
    }),
  },

  servers: {
    local: {
      driver: localDriver({ rootDir: '.data/uploads', publicBaseUrl: '/api/files' }),
      statTtlMs: 30_000,
      limits: { storageBytes: 20 * GB, fileBytes: 512 * MB },
    },
    r2: {
      url: 's3://ACCESS_KEY:SECRET_KEY@ACCOUNT.r2.cloudflarestorage.com/assets/prod',
      key: MasterKeyBytes,          // прозрачное шифрование AES-256-GCM на лету
      limits: { storageBytes: 10 * GB, fileBytes: 5 * GB },
    },
    mailru: {
      driver: webdavDriver('webdav://user%40mail.ru:APP_PASS@webdav.cloud.mail.ru/app-box'),
      key: MasterKeyBytes,
      rate: 2 * MB,                 // шейпер 2 МиБ/с на поток
      concurrency: downloadGate,    // общий семафор потоков по IP
      limits: { storageBytes: 8 * GB, fileBytes: 2 * GB },
    },
  },
})
```

### Главные терминологические и архитектурные правила

1. **`path` — путь файла, `key` — строго ключ шифрования.** Во всех методах, записях `ledger` и драйверах относительный путь объекта называется `path` (нормализуется через `normalizeStoragePath`: без ведущего `/`, `\`, `\0` и сегментов `..`). Имя `key` зарезервировано исключительно за ключом `AES-256-GCM`.
2. **Обязательные `limits` на каждом сервере.** Каждый сервер обязан явно задать `limits: { storageBytes, fileBytes }` (`> 0`). Это исключает бесконтрольное переполнение бесплатных тарифов S3/WebDAV и даёт планировщику `most-free` и `split` точные границы.
3. **Мягкая деградация необязательных подсистем.** Если `store` не передан, а на сервере указан `statTtlMs`, или включён `concurrency: { scope: 'ip' }`, но `tech.resolveMeta` не вернул `ip`, хранилище **не падает**: зависимая оптимизация пропускается с явной диагностикой в `console.error`.
4. **Динамическое добавление и снятие серверов на лету.** Методы `storage.setServer(name, entry)` и `await storage.removeServer(name)` позволяют подключать пользовательские облака на время запроса (например, из зашифрованного браузерного куки-сейфа); удалить сервер с активной бронью (`reservedBytes > 0`) нельзя.

---

## 3. Драйверы серверов и строковые DSN

Сервер в `servers` можно объявить либо готовым `driver`, либо строкой `url` (`s3://...` или `webdav://...` — схему разберёт сам `createStorage`). Для безопасного отображения подключённых адресов в UI предусмотрены `maskS3Url(url)` и `maskWebdavUrl(url)`, скрывающие секреты.

### 3.1. S3-драйвер (`#lib/storage/s3.js`)

Работает с AWS S3, Cloudflare R2 (включая юрисдикционные эндпоинты `<account>.<jurisdiction>.r2.cloudflarestorage.com`), Backblaze B2, MinIO и Garage поверх `aws4fetch`.

```ts
import { s3Driver } from '#lib/storage/s3.js'

const r2 = s3Driver({
  endpoint: 'https://acc123.eu.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'media',
  prefix: 'uploads/v1',
  accessKeyId: '...',
  secretAccessKey: '...',
  forcePathStyle: true,
  partSizeBytes: 8 * 1024 * 1024, // минимум 5 МиБ по стандарту S3
})
```

- **Одиночный поток и Multipart Upload без буферизации файла в RAM.** Потоки до порога части отправляются одиночным `PUT` (`x-amz-content-sha256: UNSIGNED-PAYLOAD`). Для крупных и безразмерных потоков драйвер делает предчтение двух частей: если поток уместился в первую часть, уходит один `PUT` (без лишних `CreateMultipartUpload` / `CompleteMultipartUpload`); иначе открывается Multipart Upload с равномерным размером всех нефинальных частей (требование Cloudflare R2, потолок `10 000` частей).
- **Гарантии целостности S3.** При любой ошибке или отмене `AbortSignal` вызывается `AbortMultipartUpload` (чтобы в бакете не копились платные «осиротевшие» части). При `CompleteMultipartUpload` части сортируются по `PartNumber`, `<ETag>` экранируется в XML, а тело даже при статусе `200 OK` проверяется на встроенный `<Error>` (специфика S3/R2 при сбое сборки на стороне кластера).
- **Серверный `CopyObject` и защита редиректов.** Внутри одного S3-сервера без перешифрования задействуется нативный `CopyObject` с RFC-3986 кодированием `x-amz-copy-source` и проверкой `200 OK` `<Error>`. Все запросы выполняются с `redirect: 'manual'`, чтобы `301`/`302` не уводил заголовки авторизации и не превращал `PUT` в `GET`.

### 3.2. WebDAV-драйвер (`#lib/storage/webdav.js`)

Чистый Web-драйвер на стандартном `fetch` и потоках `ReadableStream` (`0` зависимостей от Node-пакетов; проверен вживую на `https://webdav.cloud.mail.ru`).

```ts
import { webdavDriver } from '#lib/storage/webdav.js'

const dav = webdavDriver({
  url: 'https://webdav.cloud.mail.ru/modals-kit-sandbox',
  username: 'user@mail.ru',
  password: 'app-password',
  readOnly: false,
})
```

- **Строгая изоляция `basePath`.** Все операции физически заперты внутри корневой папки `basePath`: драйвер никогда не поднимается выше неё, не трогает соседние пользовательские каталоги и отбрасывает любые `<d:href>` в ответах `PROPFIND`, выходящие за пределы запрошенного префикса (`HREF-ESCAPE` защита).
- **Устойчивый разбор `PROPFIND` и `MKCOL`.** Создание вложенных директорий `MKCOL` кэшируется и дедуплицируется между параллельными потоками (`inflightMkcol`), чтобы конкурентные загрузки не ловили `405`/`409`. В `PROPFIND` учитываются только `<d:propstat>` со статусом `2xx`, требуется корневой `<multistatus` (защита от `200 OK` HTML-страниц входа прокси), размер XML-ответа ограничен `8 МиБ`, а `410 Gone` обрабатывается наравне с `404 Not Found`.
- **Режим `readOnly`.** При `readOnly: true` любые попытки `put` / `del` / `copy` на этот сервер блокируются как на уровне `Storage` (`StorageReadOnlyError`), так и внутри самого драйвера до отправки сетевого запроса.

### 3.3. Дисковые примитивы (`#lib/storage/local.js`) и самопроверка `probe()`

- `localDriver({ rootDir, publicBaseUrl })` пишет поток во временный `*.part` с флагом эксклюзивного создания `'wx'`, переименовывает его в целевой путь только после успешного закрытия потока и гарантированно удаляет `*.part` при обрыве клиента или ошибке диска. Чтение срезов идёт лениво по файловому дескриптору (`@remix-run/fs`).
- `await storage.probe(serverName)` проводит неразрушающую живую диагностику любого подключённого сервера: для обычного сервера выполняет цепочку `PUT` (тестовый блок в `_probe/`) → `HEAD` → `Range GET 206` (с побайтовой сверкой среза и расшифровкой `AES-256-GCM`, если задан `key`) → `DELETE`; для `readOnly`-сервера проверяет доступность чтения и работу запрета на запись.

---

## 4. Запись (`put`), потоковый `upload` и нарезка (`split`)

### 4.1. `storage.put(input)`

Принимает `ReadableStream<Uint8Array>`, `Blob` / `File` / `StreamFile` или `Uint8Array`:

```ts
const stored = await storage.put({
  path: 'releases/app-2.4.0.tar.zst',
  body: incomingStream,
  size: knownBytes,                     // рекомендуется для точной брони и S3/WebDAV Content-Length
  contentType: 'application/zstd',
  overwrite: false,                     // по умолчанию true; при false → StorageOverwriteError
  stageToDisk: false,                   // при true сначала сохраняет поток в localSpool
  server: 'auto',                       // конкретное имя сервера или 'auto'
})
```

- **Защита от случайной перезаписи (`overwrite: false`).** Перед выделением брони проверяет наличие файла в `ledger` и на целевом сервере (`driver.head`) и при совпадении бросает `StorageOverwriteError` (`code = 'storage.already-exists'`). При перезаписи существующего пути (`overwrite: true`) старые физические куски с прежних серверов аккуратно удаляются после фиксации новой записи.
- **Автовыбор сервера (`server: 'auto'`) и карантин `cooldownMs`.** Планировщик фильтрует `writePool`, исключая `readOnly`-серверы и серверы, находящиеся в карантине после сетевого/`5xx`-сбоя (`cooldownMs`). Порядок кандидатов определяется `writeStrategy`:
  - `'priority'` — первый здоровый сервер по порядку в `writePool`, куда помещается файл;
  - `'most-free'` — сервер с максимальным свободным остатком (`storageBytes - usedBytes - reservedBytes`);
  - `'round-robin'` — циклическое чередование серверов пула.

### 4.2. Мультисерверная нарезка (`split`) и дисковый спул (`stageToDisk`)

Когда файл превышает `limits.fileBytes` отдельного сервера или свободный остаток `storageBytes` на одном сервере (либо передан явный список `split: true, splitServers: ['shard_a', 'shard_b']`), планировщик раскладывает файл на последовательные части `*.part.0`, `*.part.1`, … между несколькими серверами.

**Инвариант безопасности нарезки:** резать разрешено **только** тогда, когда заранее известен `size` **и** источник поддерживает повторное чтение со смещения (`Blob` / `File` / `StreamFile`), либо включён `stageToDisk: true` с настроенным `spool: localSpool(...)`. Однопроходный сетевой `ReadableStream` без `stageToDisk` никогда не режется вслепую и не буферизуется в ОЗУ (бросается явный `RangeError`).

- В стратегиях `'priority'` и `'most-free'` планировщик плотно заполняет доступный бюджет текущего сервера, прежде чем переходить к следующему (минимум сетевых переходов при чтении).
- В стратегии `'round-robin'` при нескольких серверах в пуле части чередуются по одному чанку на сервер по кругу (полосатое размещение по шардам; при разных ключах `key` на шардах каждая часть шифруется ключом своего сервера).
- Бронь места (`ledger.reserve`) берётся атомарно сразу на все части будущего файла. Если запись хотя бы одной части оборвалась, уже записанные части удаляются, а бронь освобождается (`ledger.release`).

### 4.3. Прямой потоковый приём `multipart/form-data` (`storage.upload`)

Для обычных HTTP-маршрутов вне `wss://`-транспорта форм пакет предоставляет готовый потоковый парсер `multipart/form-data`:

```ts
const result = await storage.upload(request, {
  prefix: 'avatars',
  accept: ['image/png', 'image/jpeg', 'image/webp'],
  maxFiles: 3,
  maxFileSize: 10 * 1024 * 1024,
  server: 'auto',
})
// result.files — сохранённые StoredObject[]; result.fields — текстовые поля FormData
```

Пустые файловые инпуты браузера (`filename=""`, `0` байт) игнорируются автоматически и не расходуют `maxFiles`; имена файлов очищаются через `sanitizeUploadFileName`, а если на k-м файле сработал отказ MIME/размера/квоты, все уже записанные в рамках этого запроса файлы откатываются (`storage.del`).

---

## 5. Чтение (`lazy`, `get`, `stat`) и HTTP-раздача (`serve`)

### 5.1. Зачем нужны и `lazy()`, и `get()`

- `await storage.lazy(path, options)` возвращает `StreamFile | null` (наследник стандартного Web `File` из `@remix-run/lazy-file`), **не читая байты файла**. У него уже известны `size`, `type`, `lastModified`, а вызов `file.slice(start, end).stream()` скачает с диска/S3/WebDAV (и при необходимости расшифрует) **только запрошенный диапазон байт**.
- `await storage.get(path, options)` возвращает готовый `ReadableStream<Uint8Array> | null` для линейного чтения с начала до конца.
- `await storage.stat(path, { server })` возвращает полный манифест `StoredFileRecord` (открытый `size`, физический `storedBytes`, массив `parts` с серверами и флагами `encrypted`; при переданном `server` проверяет указанный сервер, реплику `@replica:<server>:<path>` или прямой `driver.head`).
- `await storage.has(path, { server })` и `await storage.list({ prefix, server, cursor, limit })` проверяют наличие и перечисляют логические файлы без показа служебных записей реплик.

### 5.2. HTTP-раздача `storage.serve(target, request, options)`

Метод `serve` принимает три вида целей:
1. строковый `path` в хранилище (`'releases/app.zip'`);
2. уже загруженный манифест `StoredFileRecord` (без повторного похода в `ledger`);
3. произвольный экземпляр `File` / `StreamFile`.

```ts
// src/routes/api/files/[...path]/+server.ts
export const GET: RequestHandler = async ({ params, request, url }) => {
  return storage.serve(params.path, request, {
    download: url.searchParams.get('download') === '1'
      ? (url.searchParams.get('name') || true)
      : false,
    cdnRedirect: url.searchParams.get('cdn') === '1',
  })
}
```

Что делает `storage.serve` автоматически:
- отвечает на `GET` и `HEAD`, выставляет `Accept-Ranges: bytes`, по умолчанию генерирует сильный (`strong`) $O(1)$ `ETag` на основе SHA-256 метаданных объекта без вычитывания потока в ОЗУ (`"..."`), `Last-Modified`, обрабатывает условные запросы (`If-None-Match` / `If-Modified-Since` → `304 Not Modified`), частичные запросы и браузерное авто-возобновление докачки (`Range` + `If-Range` → `206 Partial Content` с `Content-Range`, либо `200 OK` при устаревшем `ETag`) и невалидные диапазоны (`416 Range Not Satisfiable`);
- при нарезанном (`split`) файле прозрачно склеивает поток **прямо поперёк границы частей**, лежащих на разных серверах и зашифрованных разными ключами, читая только затронутые части и только нужные 64-КиБ кадры;
- выставляет защитные заголовки ответа: `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin` и `Content-Security-Policy: default-src 'none'; sandbox`;
- для потенциально активных MIME (`text/html`, `image/svg+xml`, `application/javascript`, `text/xml` и др.) **принудительно** включает `Content-Disposition: attachment` даже при `download: false`;
- кодирует кириллические и спецсимвольные имена скачивания по **RFC 5987** (`filename="ascii_fallback"; filename*=UTF-8''...`) без риска CRLF-инъекции;
- при срабатывании `concurrency` в режиме `'reject'` прогревает первый чанк потока **до** отправки заголовков и возвращает честный `429 Too Many Concurrent Streams` (`Retry-After: 1`) вместо обрыва уже начатого `200 OK`.

---

## 6. Потоковое шифрование `AES-256-GCM`

Если на сервере или в конкретном вызове (`put` / `get` / `lazy` / `serve` / `copy`) передан `key` (`Uint8Array` от 16 байт или непустая парольная фраза; `key: null` на вызове принудительно отключает ключ сервера), данные шифруются на лету по схеме **STREAM AEAD** (`src/lib/storage/crypto.ts`):

```
[ 8 Б: "MKSG1\0\0\0" ][ 24 Б: случайная соль файла ][ Кадр 0 ][ Кадр 1 ] ... [ Финальный кадр ]
Кадр i = [ 12 Б IV (выведенный префикс XOR индекс i) ][ до 65 536 Б шифротекста ][ 16 Б GCM-тег ]
```

- **Уникальный подключ на каждый файл.** Из мастер-ключа и случайной 24-байтной соли файла через `HKDF-SHA-256` выводится одноразовый ключ `AES-256-GCM` и базовый префикс nonce (импортированные мастер-ключи `Web Crypto` кэшируются с минимальными привилегиями `['deriveBits']`).
- **Защита от перестановки чанков и усечения хвоста.** В `AAD` каждого 64-КиБ кадра зашиты номер кадра (`uint64`) и признак последнего кадра (`0x01` против `0x00`). Злоумышленник или оборванное облако не могут поменять два блока местами или незаметно отрезать конец файла: при чтении последнего байта отсутствие финального тега вызывает немедленный `StorageCryptoError`.
- **Произвольный `Range`-доступ за $O(1)$.** Поскольку размер открытого блока фиксирован (`65 536` байт), `createDecryptedStreamFile` по байтовому диапазону `[start, end)` вычисляет номера первого и последнего нужных кадров, запрашивает у драйвера (`S3` / `WebDAV` / `local`) только этот срез шифротекста, проверяет аутентичность каждого прочитанного кадра и отдаёт точный срез открытых байт.
- **Точная арифметика квот.** Функции `encryptedSize(plainBytes)` и `decryptedSize(cipherBytes)` считают физический вес до записи, поэтому `ledger` и планировщик `split` бронируют точное число байт с учётом заголовка и GCM-тегов.

---

## 7. Шейпер скорости (`rate`) и семафоры потоков (`concurrency`)

Оба ограничителя работают симметрично на запись (`put` / `upload`) и на чтение (`get` / `lazy` / `serve`) и задаются либо на сервере, либо точечно на вызове (`rate: 0` и `concurrency: 0` снимают серверное ограничение для конкретного вызова):

```ts
import { createBandwidthLimiter, createConcurrencyGate } from '#lib/storage/index.js'

const sharedLimiter = createBandwidthLimiter(512 * 1024) // общий бюджет 512 КиБ/с
const sharedGate = createConcurrencyGate('public-dl', {
  maxConcurrent: 2,
  scope: 'ip',          // 'global' | 'ip' | 'client'
  mode: 'preempt',      // 'reject' | 'queue' | 'preempt'
  queueTimeoutMs: 10_000,
})
```

| Режим `mode` | Поведение при исчерпании слотов `maxConcurrent` |
|---|---|
| `'reject'` | Мгновенно бросает `StorageConcurrencyError` (в `storage.serve()` автоматически превращается в `HTTP 429` с `Retry-After: 1`) |
| `'queue'` | Ставит новый поток в FIFO-очередь до освобождения слота или истечения `queueTimeoutMs` / отмены `signal` |
| `'preempt'` | Немедленно отменяет самый старый активный поток в этом же `scope` через внутренний `AbortController` и отдаёт слот новому запросу (удобно, когда видеоплеер или пользователь перематывает поток серией `Range`-запросов) |

Экземпляр `createConcurrencyGate(...)` можно создать один раз на модульном уровне и передавать в `createStorage` или в `serve(..., { concurrency: gate })` — тогда пул активных слотов остаётся общим даже тогда, когда сам экземпляр `Storage` собирается заново на каждый HTTP-запрос (как при динамическом куки-сейфе). Для зашифрованных и нарезанных (`split`) файлов слот удерживается на всём протяжении чтения внешнего потока, а не на отдельных 64-КиБ кадрах.

---

## 8. Реестр квот (`ledger`), кэш `store` и связка с PostgreSQL

### 8.1. Контракт `StorageLedger` (`defineStorageLedger`)

Реестр отвечает за учёт занятого места по серверам, временные брони во время загрузки и хранение манифестов нарезанных/зашифрованных файлов:
- `memoryLedger()` (`#lib/storage/index.js`) — быстрый in-memory реестр для тестов и эфемерных стендов;
- `jsonLedger({ filePath })` (`#lib/storage/local.js`) — файловый реестр одного Node-процесса с атомарной записью через `*.tmp` → `rename` и сериализацией параллельных мутаций;
- `pgStorageLedger(db)` (`#hooks/storage-db.js`) — промышленный межинстансовый реестр поверх `#lib/db` (ресурсы `storageFile` → `public.storage_file` и `storageReservation` → `public.storage_reservation`).

В `pgStorageLedger` проверка остатка квоты и вставка брони выполняются внутри транзакции под транзакционной блокировкой PostgreSQL `pg_advisory_xact_lock(hashtext('storage_ledger'), hashtext(server))` с часами СУБД (`clock_timestamp()`), что полностью исключает гонку превышения `limits.storageBytes` между параллельными воркерами и serverless-инстансами.

### 8.2. Кэш метаданных `StorageStore` (`defineStorageStore`)

Если передать `store` и указать `statTtlMs` на сервере, результаты `head()` кэшируются между запросами и автоматически инвалидируются при `put`, `del`, `copy`, `move` и `clone`:
- `memoryStore({ maxEntries })` (`#lib/storage/index.js`) — автономный LRU/TTL-кэш внутри пакета;
- `cacheStorageStore(store)` (`#hooks/storage-db.js`) — переходник к любому `Store` из `#lib/cache` (`localStore.scope(...)` или `sharedStore.scope(...)`).

---

## 9. Межсерверные операции (`copy`, `move`, `clone`) и телеметрия

- **`await storage.copy({ path, from, to, toPath })`** — потоково копирует файл между любыми двумя серверами (`local ↔ S3 ↔ WebDAV ↔ memory`) без буферизации в ОЗУ:
  - внутри одного сервера с поддержкой `copyObject` (S3 `CopyObject`, WebDAV `COPY`) и неизменном ключе шифрования выполняется мгновенное серверное копирование;
  - между разными серверами одиночный зашифрованный файл с тем же самым `key` переливается байт-в-байт сырым шифротекстом без лишней расшифровки/зашифровки;
  - если ключи отличаются или исходник был нарезан (`split`), поток прозрачно расшифровывается на чтении и зашифровывается ключом целевого сервера на записи;
  - если `toPath` не указан (создаётся **реплика** под тем же `path` на другом сервере), запись реплики хранится отдельно от основного маршрута: при падении основного сервера и уходе его в `cooldownMs` чтение (`get` / `lazy` / `serve`) может обслуживаться с живой реплики, а `del(path)` уберёт и оригинал, и его реплики.
- **`await storage.move({ path, from, to, toPath })`** — копирует объект на целевой сервер, переключает манифест `ledger` и удаляет физические части со старого сервера.
- **`await storage.clone({ from, to, prefix, overwrite })`** — пакетно клонирует все файлы выбранного сервера (или префикса) на другой сервер и возвращает отчёт `{ clonedPaths, skippedPaths, transferredBytes }`.
- **`await storage.report()` и `#lib/storage/state.js`** — `report()` объединяет данные `ledger` (`usedBytes`, `reservedBytes`, `filesCount`, `partsCount`), лимиты и состояние карантина по каждому серверу, а `createStorageState()` собирает живую телеметрию активных потоков (`activeUploads`, `activeDownloads`, `bytesWritten`, `bytesRead`, `errorsCount`, `subscribe()`).

### Связка с `wss://`-загрузкой форм и стендом `/upload-demo`

В приложении `#lib/storage` работает в паре с потоковым WebSocket-транспортом форм (`src/hooks/component-form/{ws-session.server.ts,ws-client.ts,ws-integrity.ts}`):
1. На Кадре 0 сервер проверяет права (`authorize`) и поля формы при `0` переданных файловых байтов.
2. Файлы передаются сегментами по `256 КиБ` с опциональной одноразовой солёной цепочкой `HMAC-SHA-256` и оборачиваются в ленивый `StreamFile`, откуда байты без промежуточного накопления в памяти текут напрямую в `storage.put(...)`.
3. Полный интерактивный стенд всех режимов загрузки, куки-сейфа S3/WebDAV, нарезки `split` (`shard_a + shard_b`), проверки склейки `Range 206` поперёк шва, `ETag 304`, `rate` и `concurrency` расположен на маршруте `/upload-demo` ([`src/routes/(site)/(app)/upload-demo/+page.svelte`](../../routes/(site)/(app)/upload-demo/+page.svelte)).

---

## 10. Ошибки, инварианты безопасности и проверка

| Класс ошибки | Код (`err.code`) | Когда возникает | Рекомендуемый HTTP-код |
|---|---|---|---|
| `StorageQuotaError` | `'storage.quota-exceeded'` | Исчерпан `limits.storageBytes` сервера или пула | `413` / `422` / `507` |
| `StorageReadOnlyError` | `'storage.read-only'` | Попытка записи/удаления на сервере с `readOnly: true` | `403` / `422` |
| `StorageOverwriteError` | `'storage.already-exists'` | Путь уже занят при `put({ overwrite: false })` | `409` / `422` |
| `StorageCryptoError` | `'storage.crypto-failed'` | Неверный ключ `key`, подмена байтов, перестановка чанка или усечение хвоста | `422` / `500` |
| `StorageConcurrencyError` | `'storage.concurrency-exceeded'` | Исчерпан лимит параллельных потоков (`reject` или таймаут `queue`) | `429` (`serve` ставит сам) |
| `StorageUploadError` | `'upload.max-files'` / `'upload.max-size'` / `'upload.accept'` / `'upload.malformed'` | Нарушение ограничений `storage.upload(request, options)` | `413` / `415` / `422` |

Команды проверки пакета и его архитектурных границ:

```bash
npx vitest run src/lib/storage src/hooks/storage-db.test.ts "src/routes/api/files/[...path]/files.server.test.ts"
node tooling/public-api.mjs
node --test tooling/core-purity.test.mjs tooling/public-api.test.mjs tooling/layer-guard.test.mjs
npm run check
```
