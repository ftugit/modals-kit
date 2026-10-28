# План: `lib/storage` — поэтапная разработка

Заказ владельца. Этапы задаются владельцем по мере продвижения: разбираем,
проверяем и утверждаем **только текущий этап**; ответы и замечания владельца
сохраняются прямо внутри этапа; код в `src/` пишется только по явной команде
после согласования решений.

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
3. **Точка остановки (`STOPPED AT`):** Этап 1 — в проект API добавлены
   двустороннее ограничение скорости стрима (`throttleStream` / `BandwidthLimiter`)
   и потоковая переброска файлов между хранилищами (`transfer` / `copyTo` /
   `moveTo`), прояснено шифрование собственным ключом для хранения «мусора» на
   конечном сервере; ждём подтверждения объёма Этапа 1 и команды на старт кода.

---

## Состояние этапов по коммитам (обновлено 2026-10-28)

| Этап | Содержание | Состояние | Коммиты |
|---|---|---|---|
| **1. Стриминг, шейпинг скорости, переброска между хранилищами и адаптер `webdav`** | Каркас `createStorage` + `serveFile` + `transfer` + двусторонний лимит скорости на `@remix-run/lazy-file` и `@remix-run/response` (0 SvelteKit), адаптер `webdav`, стенд Облака Mail.ru | **На финальном согласовании перед кодом** | — |

---

# Этап 1. Стриминг, ограничение скорости, перенос между хранилищами и `webdav`

## 1.1. Решения и замечания владельца (хронология)

1. **Фокус сейчас:** приём от браузера-клиента пока не трогаем; сначала делаем
   чтение/отдачу стримом, ограничение скорости потока в любую сторону и перенос
   между хранилищами; стенд для живого теста — личное **Облако Mail.ru по WebDAV**.
2. **Готовая база стриминга:** `@remix-run/lazy-file` + `@remix-run/response`
   (никакого SvelteKit внутри пакета — переносится в React обычным копированием).
3. **По API:** `lazy()` оставляем про запас.
4. **Шифрование — именно своим секретным ключом (хранение «бессмысленного файла» на сервере облака):**
   цель — чтобы на конечном сервере (Mail.ru, R2 и т.д.) лежал нечитаемый набор
   случайных байт, который без нашего ключа невозможно ни открыть, ни распознать
   по содержимому.
5. **Двустороннее ограничение скорости стрима (rate / bandwidth limiting):**
   должно работать на поток **в любую сторону** — и при загрузке на WebDAV, и при
   отдаче из WebDAV клиенту, и при перекачке из одного хранилища в другое.
6. **Переброска файлов между хранилищами:** сразу предусмотреть потоковый
   перенос/копирование между двумя экземплярами `Storage`.

---

## 1.2. Шифрование своим ключом (что именно лежит на конечном сервере)

Речь шла **не** про транспортный HTTPS/TLS, а именно про **криптографическое
шифрование твоим секретным мастер-ключом (256 бит)** до отправки байтов в облако:

1. **Что хранится на самом Mail.ru / R2 / любом облаке:**
   - На диске облака лежит **сплошной нечитаемый бинарный шум** (даже заголовок
     формата `MP4` / `JPEG` / `ZIP` полностью зашифрован; при желании и само имя
     ключа в облаке делается обезличенным вроде `f91c8a...bin`).
   - Админ облака, утечка бакета или взлом аккаунта WebDAV без твоего 32-байтного
     ключа `secretKey` видят только случайные байты, которые не открываются ни
     одной программой.
2. **Как это сочетается со стримом без скачивания файла на сервер:**
   - Твой `secretKey` остаётся только в env приложения. При записи файла из него
     через `HKDF-SHA256` + случайную 16-байтную соль файла выводится уникальный
     ключ этого файла.
   - Поток на лету в `TransformStream` режется по **64 КБ** и шифруется твоим
     ключом через `AES-256-GCM` (`crypto.subtle`). Шифротекст сразу улетает в
     WebDAV, а при чтении — блоки по `64 КБ + 16 байт` качаются из WebDAV и тут
     же расшифровываются твоим ключом в поток клиенту (в RAM на сервере всегда
     только один 64-КБ кусок, и работает перемотка видео `206 Range`).
   - В архитектуру ложится обёрткой `withEncryption(adapter, { key })` поверх
     любого `StorageAdapter`.

---

## 1.3. Двустороннее ограничение скорости стрима (в любую сторону)

Чтобы ограничивать скорость и отдельного потока, и суммарно всего канала к
хранилищу, в ядро закладывается **Token Bucket шейпер поверх Web `TransformStream`**:

1. **Как он тормозит и отдачу, и приём без роста памяти (backpressure):**
   - В стандарте Web Streams `ReadableStream.pipeThrough(throttleStream(...))` с
     буфером в 1 чанк (`highWaterMark: 1`) создаёт естественное обратное давление:
   - **Из WebDAV → клиенту (или во второе хранилище):** когда шейпер придерживает
     очередную порцию байтов, он перестаёт вызывать `pull()` у входящего потока
     `fetch` — TCP-окно сокета к WebDAV заполняется, и **сам WebDAV замедляет
     отправку**, не набивая оперативную память нашего сервера.
   - **В сторону WebDAV (`put`):** шейпер нарезает и выдаёт чанки в исходящий
     `fetch(..., { method: 'PUT', body, duplex: 'half' })` ровно с заданной
     скоростью `bytesPerSecond`.
   - **Плавная нарезка тиками по `16–32 КБ`:** если `fetch` выдал из сети сразу
     кусок 256 КБ при лимите 64 КБ/с, шейпер не «замирает» на 4 секунды (рискуя
     словить idle-timeout сокета в Bun/Cloudflare), а режет кусок на ровные доли
     по 16 КБ каждые ~250 мс и мгновенно прерывает ожидание по `AbortSignal`.
2. **Два режима использования одним и тем же типом `RateLimitInput`:**
   - **Просто число (`bytesPerSecond: number`)** — потолок скорости на **один
     конкретный стрим** (например, не быстрее `2 МиБ/с` на одно скачивание
     клиентом в `serveFile` или на один `put`).
   - **Общий лимитер (`createBandwidthLimiter({ bytesPerSecond, burstBytes? })`)** —
     общая «труба» на несколько параллельных стримов сразу (например, повесить на
     `webdav` общий лимит записи `5 МиБ/с` и чтения `10 МиБ/с`: если качают 5
     человек одновременно, они честно поделят эти `10 МиБ/с` между собой).

---

## 1.4. Переброска файлов между хранилищами (`transfer` / `copyTo` / `moveTo`)

Так как любой `storage.get(key)` возвращает ленивый `LazyFile` с уже известными
`size`, `type` и `lastModified`, перекачка между **любыми двумя хранилищами**
(например `Mail.ru WebDAV ↔ локальный диск`, `WebDAV #1 ↔ WebDAV #2`, `WebDAV ↔ R2`,
в том числе между незашифрованным и зашифрованным хранилищем) работает **прямым
стримом из сокета в сокет без сохранения файла на промежуточном сервере**:

1. **Потоковый мост между разными хранилищами:**
   - `const src = await from.get(sourceKey, { signal })` (узнаёт точный `src.size`,
     нужный для `Content-Length` у WebDAV/Cloudflare);
   - оборачивает `src.stream()` в лимитер скорости (если передан `maxBytesPerSec`
     на сам перенос — плюс автоматически действуют лимиты `readRate` источника и
     `writeRate` приёмника);
   - стримит поток напрямую в `await to.put(targetKey, stream, { size: src.size, type: src.type, lastModified: src.lastModified, overwrite, signal })`;
   - сверяет, что записано ровно `src.size` байт, и **только после этого** при
     режиме `moveTo` (`move: true`) вызывает `await from.remove(sourceKey)` — при
     обрыве сети посередине исходный файл гарантированно остаётся цел.
2. **Быстрый путь внутри одного и того же хранилища (`adapter.copy?`):**
   - если `from === to` и у адаптера есть серверное копирование (в протоколе
     WebDAV RFC 4918 есть штатный метод `COPY` / `MOVE` прямо на стороне облака
     без прогона гигабайтов через наш сервер!), используется нативный `COPY`, если
     не запрошено перешифрование.

---

## 1.5. Обновлённый API `#lib/storage`

### Входы (`src/lib/storage/entrypoints.json`)
```json
{
  "//": "`index.js` — `createStorage`, `serveFile`, `transfer`, `throttleStream`, `createBandwidthLimiter`, типы и ошибки (0 провайдеров, 0 node:fs, 0 фреймворков); `webdav.js` — адаптер WebDAV; `state.js` — необязательный коллектор телеметрии.",
  "entrypoints": ["index.js", "webdav.js", "state.js"]
}
```

### Ключевые сигнатуры (`#lib/storage/index.js`)

```ts
/** Лимит скорости: либо байт/сек на один стрим, либо общий пул на группу стримов. */
export interface BandwidthLimiter {
  readonly bytesPerSecond: number
  readonly burstBytes: number
  acquire(bytes: number, signal?: AbortSignal): Promise<void>
}

export type RateLimit = number | BandwidthLimiter

export function createBandwidthLimiter(options: {
  readonly bytesPerSecond: number
  readonly burstBytes?: number
}): BandwidthLimiter

/** Обернуть любой ReadableStream двусторонним ограничителем скорости. */
export function throttleStream(
  stream: ReadableStream<Uint8Array>,
  limit: RateLimit,
  options?: { readonly signal?: AbortSignal; readonly chunkBytes?: number },
): ReadableStream<Uint8Array>

export interface StorageOptions {
  readonly state?: StorageStateListener
  /** Лимит скорости на чтение из этого хранилища (число байт/с или общий BandwidthLimiter). */
  readonly readRate?: RateLimit
  /** Лимит скорости на запись в это хранилище (число байт/с или общий BandwidthLimiter). */
  readonly writeRate?: RateLimit
}

export interface StorageGetOptions extends StorageCallOptions {
  /** Переопределить/дополнить лимит скорости для конкретного чтения. */
  readonly maxBytesPerSec?: RateLimit
}

export interface StoragePutOptions extends StorageCallOptions {
  readonly size?: number
  readonly type?: string
  readonly lastModified?: number
  readonly overwrite?: boolean
  /** Лимит скорости для конкретной загрузки в хранилище. */
  readonly maxBytesPerSec?: RateLimit
}

export interface ServeFileOptions {
  readonly disposition?: 'inline' | 'attachment'
  readonly filename?: string
  readonly cacheControl?: string
  readonly etag?: false | 'weak' | 'strong'
  readonly acceptRanges?: boolean
  /** Лимит скорости отдачи этому конкретному HTTP-клиенту (работает и на 200, и на 206 Range!). */
  readonly maxBytesPerSec?: RateLimit
}

export interface TransferOptions extends StorageCallOptions {
  readonly overwrite?: boolean
  /** Удалить исходный файл после успешной записи и сверки размера. */
  readonly move?: boolean
  /** Лимит скорости конкретной перекачки между хранилищами. */
  readonly maxBytesPerSec?: RateLimit
}

export interface Storage {
  readonly capabilities: StorageCapabilities
  get(key: string, options?: StorageGetOptions): Promise<LazyFile | null>
  lazy(key: string, meta: Omit<StorageStat, 'key' | 'name'> & { name?: string }, options?: { maxBytesPerSec?: RateLimit }): LazyFile
  has(key: string, options?: StorageCallOptions): Promise<boolean>
  stat(key: string, options?: StorageCallOptions): Promise<StorageStat | null>
  put(key: string, body: StorageBody, options?: StoragePutOptions): Promise<StorageStat>
  remove(key: string, options?: StorageCallOptions): Promise<void>
  list(options?: StorageListOptions): Promise<StorageListResult>

  /** Потоково скопировать файл в другое (или то же) хранилище без буферизации в RAM. */
  copyTo(key: string, target: Storage, targetKey?: string, options?: Omit<TransferOptions, 'move'>): Promise<StorageStat>
  /** Потоково переместить файл в другое хранилище (удаляет оригинал только после сверки байтов). */
  moveTo(key: string, target: Storage, targetKey?: string, options?: Omit<TransferOptions, 'move'>): Promise<StorageStat>
}

/** Та же операция отдельной функцией. */
export function transfer(
  from: Storage,
  sourceKey: string,
  to: Storage,
  targetKey?: string,
  options?: TransferOptions,
): Promise<StorageStat>
```

### Примеры трёх твоих сценариев

```ts
// 1. Общие лимиты на сам WebDAV (например: запись не быстрее 5 МиБ/с суммарно)
const uploadPool = createBandwidthLimiter({ bytesPerSecond: 5 * 1024 * 1024 })
const mailCloud = createStorage(webdav({ url, username, password, basePath: '/sandbox' }), {
  writeRate: uploadPool,
})

// 2. Отдача клиенту из WebDAV с индивидуальным потолком 1 МиБ/с на зрителя:
const file = await mailCloud.get('heavy.mp4', { signal: request.signal })
if (!file) return new Response('Not Found', { status: 404 })
return serveFile(file, request, { maxBytesPerSec: 1 * 1024 * 1024 })

// 3. Перекинуть файл из одного хранилища в другое на скорости 3 МиБ/с без загрузки на диск/в RAM:
await mailCloud.copyTo('heavy.mp4', archiveStorage, '2026/heavy.mp4', {
  maxBytesPerSec: 3 * 1024 * 1024,
  signal,
})
```

---

## 1.6. Вопрос перед стартом реализации Этапа 1

1. Включаем ли в **Этап 1** сразу `createStorage` + `serveFile` + двусторонний
   лимитер скорости (`throttleStream` / `createBandwidthLimiter`) + перенос между
   хранилищами (`copyTo` / `moveTo` / `transfer`) + адаптер `webdav`, а обёртку
   шифрования ключом (`withEncryption` на `AES-256-GCM`) выносим в **Этап 2** —
   или шифрование тоже хочешь сразу в Этапе 1?
