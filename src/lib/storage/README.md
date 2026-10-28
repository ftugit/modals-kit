# `#lib/storage` — независимое мультисерверное потоковое хранилище

Чистый автономный пакет без зависимостей от `svelte`, `@sveltejs/kit`, `#lib/db` и `#lib/cache`.
Основная точка входа (`#lib/storage/index.js`) не импортирует `node:fs` и работает в любом стандартном Web-рантайме (Node 22+, Bun, Cloudflare Workers, Vercel Functions).

## Публичные точки входа (`entrypoints.json`)

- `#lib/storage/index.js` — `createStorage`, `defineStorageLedger`, `memoryLedger`, `defineStorageStore`, `memoryStore`, `memoryDriver`, `StreamFile`, `createBandwidthLimiter`, `encryptedSize`, `decryptedSize`, ошибки (`StorageQuotaError`, `StorageReadOnlyError`, `StorageCryptoError`, `StorageConcurrencyError`).
- `#lib/storage/s3.js` — потоковый драйвер S3 (`s3Driver(dsnOrOptions)`, `parseS3Url`, `formatS3Url`, `maskS3Url`) поверх `aws4fetch` (SigV4 streaming `PUT`, S3 Multipart Upload `>= 5 МиБ` с `AbortMultipartUpload`, `Range GET` `206`).
- `#lib/storage/webdav.js` — потоковый драйвер WebDAV (`webdavDriver(dsnOrOptions)`, `parseWebdavUrl`, `formatWebdavUrl`, `maskWebdavUrl`) на чистом `fetch` без `node:*` (`MKCOL` с кэшированием коллекций, потоковый `PUT`, `PROPFIND`, `Range GET` `206`, `DELETE`, `COPY`, строгие `basePath` и `readOnly`; проверен на Облаке Mail.ru).
- `#lib/storage/local.js` — Node/Bun-адаптеры: `localDriver` (`.part` -> `rename` + `@remix-run/fs`), `jsonLedger` и дисковый спул `localSpool` (для `stageToDisk: true`).
- `#lib/storage/state.js` — необязательный коллектор телеметрии `createStorageState()`.

## Ключевые возможности

1. **Ноль буферизации файла целиком в ОЗУ**: сквозные `ReadableStream`, ленивые диапазоны `StreamFile` (`@remix-run/lazy-file`) и HTTP-раздача `serve()` (`@remix-run/response` с `200`/`206`/`416` и защитными заголовками `CSP sandbox`, `nosniff`, `CORP`).
2. **Единые DSN-ссылки и живая самопроверка**: подключение серверов одной строкой `{ url: 's3://key:secret@host/bucket/prefix', limits }` и встроенный `await storage.probe(server)` (`PUT` -> `HEAD` -> `Range 206` -> `DELETE`).
3. **Потоковое шифрование `AES-256-GCM` блоками 64 КиБ (`STREAM`)**: `key` на сервере или конкретном вызове (`key: null` — принудительно снять), 24-байтная случайная соль + `HKDF-SHA-256`, защита от усечения/перестановки блоков и расшифровка произвольного `Range` за $O(1)$ без чтения всего объекта.
4. **Двусторонний лимитер полосы (`rate`) и потоков (`concurrency`)**: режимы `'reject'` (`HTTP 429`), `'queue'` и `'preempt'` (вытеснение старого потока новым), области `'global' | 'ip' | 'client'`, сброс на вызов через `rate: 0` и `concurrency: 0`.
5. **Опциональные `store` и `tech`/`meta` с мягкой деградацией**: при отсутствии `store`, `cdnUrl` или `meta.ip` зависимая опция безопасно игнорируется с явным сообщением в `console.error`.
6. **Мультисерверная нарезка (`split`), `allowSplit`, `stageToDisk` и перенос (`copy`/`move`/`clone`)**: атомарное резервирование места в `ledger` с точным учётом `AES-256-GCM`-оверхеда и склейка `Range 206` поперёк границ разных серверов.
