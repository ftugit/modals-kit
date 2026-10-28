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
3. **Точка остановки (`STOPPED AT`):** Этап 1 — представлен проект API
   `#lib/storage` в духе `#lib/image` (без единой зависимости от SvelteKit),
   ждём замечаний владельца по API и отмашки на старт кода.

---

## Состояние этапов по коммитам (обновлено 2026-10-28)

| Этап | Содержание | Состояние | Коммиты |
|---|---|---|---|
| **1. Стриминг и базовый API `#lib/storage` (на базе `@remix-run/*` + пилот `webdav`)** | Граница с `@remix-run/*`, полный отказ от `sveltekit`-слоя внутри пакета, проект API в духе `#lib/image`, проверка на WebDAV Облака Mail.ru | **API на ревью у владельца** | — |

---

# Этап 1. Стриминг, граница с `@remix-run/*` и проект API `#lib/storage`

## 1.1. Решения и замечания владельца (хронология)

1. **Один этап сейчас:** никаких преждевременных этапов по UI и мессенджерам;
   сначала разбираемся со стримингом в окружениях и базовым API.
2. **Готовый фундамент стриминга утверждён:** берём `@remix-run/lazy-file` +
   `@remix-run/response` + `@remix-run/fs` + `@remix-run/form-data-parser`.
3. **Остальные адаптеры (`local`, `r2` и пр.) пока отложены;** живой стенд для
   проверки — личное **Облако Mail.ru по WebDAV** (с уже загруженными тяжёлыми
   файлами).
4. **Никакого SvelteKit в `lib/storage`:** вопрос владельца — *«remix-run не
   покрывает необходимое полностью? Зачем нам sveltekit?»* — и ориентир по стилю
   API: **похожий на `#lib/image`, но без искусственного копирования лишнего**.

---

## 1.2. Почему SvelteKit вообще не нужен и где точная граница `@remix-run/*`

### 1. Зачем нам `sveltekit` в `lib/storage`? — **Низачем, убираем полностью**
Ровно как в `src/lib/image` нет ни папки `svelte/`, ни `sveltekit/`, в
`src/lib/storage` **не будет ни одного упоминания Svelte или SvelteKit**. Все
современные серверные среды (SvelteKit, Next.js App Router / React Router v7 в
React, Hono, Cloudflare Workers, Bun) работают на одних и тех же Web `Request`,
`Response`, `File` и `ReadableStream`. Папка `src/lib/storage` переносится в
React-проект обычным копированием без правок.

### 2. Что `@remix-run/*` уже покрывает на 100%, а чего в нём нет

| Задача | Покрывает `@remix-run/*`? | Детали |
|---|---|---|
| Ленивый потоковый `File` / `Blob` со срезами `.slice(a, b).stream()` без загрузки в RAM | **Да, полностью** (`@remix-run/lazy-file`) | Писать свой класс ленивого файла не нужно. |
| HTTP-раздача файла в `Response`: `Range` (`206`), `416`, `ETag`, `304`, `If-Range`, `HEAD`, `nosniff` | **Да, полностью** (`@remix-run/response` → `createFileResponse`) | Писать свой парсер заголовков и `Range`-математику не нужно. |
| Локальная ФС в Node и Bun (`openLazyFile`, `writeFile` с `drain` backpressure) | **Да, полностью** (`@remix-run/fs`) | Готовая база под будущий локальный адаптер. |
| Потоковый приём `multipart/form-data` от клиента (+ обход утечки `Blob#stream()` в Node) | **Да, полностью** (`@remix-run/form-data-parser`) | Готовая база для приёма загрузок без буфера в RAM. |
| **Адаптер WebDAV** (в т.ч. `webdav.cloud.mail.ru` с `PROPFIND`, `Range`, `PUT` + `duplex: 'half'`) | **Нет** | В `@remix-run/file-storage` есть только `fs` и `memory`. |
| **Честный потоковый S3/R2 на чтении** + нативный Cloudflare `R2Bucket` binding | **Нет** | В их `@remix-run/file-storage-s3` (`s3.ts:282`) метод `get()` вызывает `await response.arrayBuffer()`, грузя весь файл в RAM. |
| **Защита ключей и песочница** (`..` traversal, `basePath`, `readOnly`), `AbortSignal`, телеметрия `state`, кастомные облака | **Нет** | В базовом интерфейсе `FileStorage` у Remix нет `signal`, нет `stat()` отдельно от файла, нет `readOnly`/`basePath` и нет `capabilities`. |

**Итог:** `@remix-run/*` берёт на себя всю тяжёлую платформенную механику потоков
и HTTP, а `src/lib/storage` — это только лёгкий фасад, предохранители и сами
адаптеры внешних хранилищ (начиная с `webdav`), возвращающие их же `LazyFile`.

---

## 1.3. Предлагаемый API `#lib/storage` (в духе `#lib/image`, но без натяжек)

### Что именно берём от философии `src/lib/image` (и чего НЕ тащим зря)

**Что роднит с `lib/image`:**
1. **Узкие входы в `entrypoints.json` без лишнего веса:** статический импорт
   `#lib/storage/index.js` не тащит ни `node:fs`, ни код конкретных облаков;
   каждый адаптер — отдельный вход (`#lib/storage/webdav.js`, позже `node.js`,
   `r2.js` — как `#lib/image/node.js` и `#lib/image/probe.js`).
2. **Стандартный `Blob` / `File` (`LazyFile`) как единая валюта:** то, что вышло
   из `storage.get()`, напрямую подходит и в `serveFile(file, request)`, и в
   `probeImageHeader` из `#lib/image/probe.js` (через `file.slice(0, 65536)`
   скачается только первые 64 КБ!), и во второй `storage.put()` для перекачки
   между облаками без буфера в памяти.
3. **Явная передача адаптера и политики снаружи:** библиотека не лазит сама в
   `process.env` и не знает бизнес-правил приложения.
4. **Необязательный `options.state?: (event: StorageEvent) => void` и `signal?: AbortSignal`:**
   как в `image(..., { signal, state })` — ошибки слушателя `state` изолированы
   `try/catch`, а снаружи при необходимости стыкуются с `#lib/task` или
   React `useSyncExternalStore`.
5. **Именованные классы ошибок и декларация `capabilities` у адаптера** (как
   `EnvironmentError` / `InvalidOptionsError` и `CodecCapabilities` в `lib/image`).

**Чего НЕ копируем из `lib/image` (потому что у хранилища другая природа):**
- Не делаем искусственную callback-цепочку `storage(key, s => s.foo().bar())`
  (в `lib/image` конвейер гонит один RGBA-кадр через шаги трансформации, а
  хранилище — это долгоживущий клиент с операциями `get` / `stat` / `put` /
  `remove` / `list`).
- Не делаем глобальный мутабельный реестр вроде `registerEncoder` — экземпляры
  создаются явно через `createStorage(adapter, options)`.

---

### Входы пакета (`src/lib/storage/entrypoints.json`)

```json
{
  "//": "`index.js` — лёгкий фасад `createStorage`, HTTP-раздача `serveFile`, приём `receiveFiles`, типы и ошибки (0 провайдеров и 0 node:fs); `webdav.js` — адаптер WebDAV на чистом fetch; `state.js` — необязательный коллектор телеметрии.",
  "entrypoints": ["index.js", "webdav.js", "state.js"]
}
```
*(Когда позже добавим локальный диск и R2 — просто добавятся входы `"node.js"` и `"r2.js"`, не трогая `index.js`.)*

---

### Публичные типы и сигнатуры (`#lib/storage/index.js`)

```ts
import type { LazyFile } from '@remix-run/lazy-file'

/** Что реально умеет подключённый адаптер (честные флаги без угадывания). */
export interface StorageCapabilities {
  readonly range: boolean       // побайтовое чтение среза без скачивания с начала
  readonly write: boolean       // false, если включён readOnly
  readonly list: boolean        // листинг по префиксу (PROPFIND / ListObjects)
  readonly presignGet: boolean  // прямая временная ссылка на скачивание
  readonly presignPut: boolean  // прямая временная ссылка на загрузку с клиента
}

/** Метаданные объекта без открытия потока байтов. */
export interface StorageStat {
  readonly key: string
  readonly name: string
  readonly size: number
  readonly type: string         // MIME-тип (или 'application/octet-stream')
  readonly lastModified: number // unix ms
  readonly etag?: string
}

/** Что можно передать на запись в put(). */
export type StorageBody =
  | Blob                        // включая нативный File и LazyFile!
  | ReadableStream<Uint8Array>
  | Uint8Array
  | ArrayBuffer

export interface StorageCallOptions {
  readonly signal?: AbortSignal
}

export interface StoragePutOptions extends StorageCallOptions {
  /** Нужен только если body — голый ReadableStream без известного .size. */
  readonly size?: number
  readonly type?: string
  readonly lastModified?: number
  /** Запретить перезапись существующего файла (If-None-Match: * где доступно). */
  readonly overwrite?: boolean
}

export interface StorageListOptions extends StorageCallOptions {
  readonly prefix?: string
  readonly limit?: number
  readonly cursor?: string
}

export interface StorageListResult {
  readonly entries: readonly StorageStat[]
  readonly cursor?: string
}

/** Инженерная телеметрия (как PipelineEvent в #lib/image, без знания о #lib/task). */
export type StorageEvent =
  | { readonly type: 'stat'; readonly key: string; readonly hit: boolean; readonly elapsedMs: number }
  | { readonly type: 'read-open'; readonly key: string; readonly start: number; readonly end: number }
  | { readonly type: 'write-start'; readonly key: string; readonly size?: number }
  | { readonly type: 'write-progress'; readonly key: string; readonly writtenBytes: number; readonly totalBytes?: number }
  | { readonly type: 'write-done'; readonly key: string; readonly stat: StorageStat; readonly elapsedMs: number }
  | { readonly type: 'remove'; readonly key: string; readonly elapsedMs: number }
  | { readonly type: 'error'; readonly op: string; readonly key?: string; readonly error: unknown }

export type StorageStateListener = (event: StorageEvent) => void

export interface StorageOptions {
  /** Необязательный наблюдатель (ошибки внутри него не роняют операции). */
  readonly state?: StorageStateListener
}

/** Экземпляр хранилища, возвращаемый createStorage(). */
export interface Storage {
  readonly capabilities: StorageCapabilities

  /**
   * Получить ленивый файл по ключу (или null, если объекта нет).
   * Байты файла здесь НЕ качаются в память: читаются только метаданные (stat),
   * а сам поток откроется лениво при вызове file.stream() или file.slice(a, b).stream().
   */
  get(key: string, options?: StorageCallOptions): Promise<LazyFile | null>

  /**
   * Собрать LazyFile БЕЗ предварительного сетевого запроса stat/HEAD,
   * когда метаданные (size, type, lastModified) уже известны приложению из БД.
   * Экономит 1 сетевой RTT при раздаче файла.
   */
  lazy(key: string, meta: Omit<StorageStat, 'key' | 'name'> & { name?: string }): LazyFile

  /** Проверить наличие объекта без скачивания тела. */
  has(key: string, options?: StorageCallOptions): Promise<boolean>

  /** Получить только метаданные (размер, MIME, mtime, etag) или null. */
  stat(key: string, options?: StorageCallOptions): Promise<StorageStat | null>

  /** Потоково записать объект и вернуть его итоговые метаданные. */
  put(key: string, body: StorageBody, options?: StoragePutOptions): Promise<StorageStat>

  /** Удалить объект (идемпотентно: отсутствие файла — не ошибка). */
  remove(key: string, options?: StorageCallOptions): Promise<void>

  /** Постраничный список объектов по префиксу (бросает UnsupportedStorageOpError, если capabilities.list === false). */
  list(options?: StorageListOptions): Promise<StorageListResult>
}

/** Контракт адаптера (аналог Codec/Decoder в #lib/image) — то, что реализует webdav.ts, r2.ts, node.ts. */
export interface StorageAdapter {
  readonly name: string
  readonly capabilities: StorageCapabilities
  stat(key: string, options?: StorageCallOptions): Promise<StorageStat | null>
  openStream(key: string, range?: { start: number; end: number }, options?: StorageCallOptions): ReadableStream<Uint8Array>
  put?(key: string, stream: ReadableStream<Uint8Array>, meta: { size?: number; type?: string }, options?: StoragePutOptions): Promise<StorageStat>
  remove?(key: string, options?: StorageCallOptions): Promise<void>
  list?(options?: StorageListOptions): Promise<StorageListResult>
}

export function createStorage(adapter: StorageAdapter, options?: StorageOptions): Storage
```

*(Обрати внимание, насколько прост `StorageAdapter`: автору любого нового
адаптера достаточно написать `stat` + `openStream(key, range)` + `put` +
`remove` — а сборку `LazyFile`, проверку ключей от `../`, подсчёт прогресса
записи, `readOnly`-блокировку и события `state` делает `createStorage` один раз
для всех!)*

---

### Раздача и приём по HTTP (там же в `#lib/storage/index.js`)

```ts
export interface ServeFileOptions {
  /** 'inline' (видео/картинки в браузере) или 'attachment' (скачать). */
  readonly disposition?: 'inline' | 'attachment'
  /** Имя файла для заголовка Content-Disposition (с UTF-8 кодированием RFC 5987). */
  readonly filename?: string
  readonly cacheControl?: string
  readonly etag?: false | 'weak' | 'strong'
  readonly acceptRanges?: boolean
}

/**
 * Отдать любой File или LazyFile в стандартный Web Response.
 * Внутри — @remix-run/response createFileResponse (200 / 206 Partial Content /
 * 304 Not Modified / 416 / HEAD) + Content-Disposition и проброс request.signal.
 */
export function serveFile(
  file: File,
  request: Request,
  options?: ServeFileOptions,
): Promise<Response>
```

---

### Примеры реального использования (SvelteKit, React/Next.js, Hono — код идентичен)

```ts
import { createStorage, serveFile } from '#lib/storage/index.js'
import { webdav } from '#lib/storage/webdav.js'
import { probeImageHeader } from '#lib/image/probe.js'

// 1. Подключаем твоё Облако Mail.ru в безопасном режиме только для чтения
const mailCloud = createStorage(
  webdav({
    url: 'https://webdav.cloud.mail.ru',
    username: env.WEBDAV_USER,
    password: env.WEBDAV_APP_PASSWORD,
    basePath: '/',      // или '/test-folder' при тестах записи
    readOnly: true,     // физически блокирует put/remove на личном облаке
  }),
)

// 2. Раздать тяжёлое видео клиенту с перемоткой (206 Range) и 0 буферизации в RAM:
export async function GET({ request, params }: { request: Request; params: { path: string } }) {
  const file = await mailCloud.get(params.path, { signal: request.signal })
  if (!file) return new Response('Not Found', { status: 404 })

  return serveFile(file, request, {
    disposition: 'inline',
    cacheControl: 'private, max-age=3600',
  })
}

// 3. Естественная стыковка с #lib/image без скачивания всего файла:
const pic = await mailCloud.get('photos/raw-20mb.jpg')
if (pic) {
  // Качает с WebDAV по Range ТОЛЬКО первые 64 КБ!
  const head = new Uint8Array(await pic.slice(0, 65_536).arrayBuffer())
  const info = probeImageHeader(head) // { format: 'image/jpeg', width, height, ... }
}

// 4. Потоковая перекачка файла в другое хранилище без загрузки в память:
// const src = await mailCloud.get('archive.zip')
// if (src) await backupStorage.put('archive.zip', src)
```

---

## 1.4. Вопросы владельцу по предложенному API

1. Как тебе такой вид API (`createStorage(webdav(...), { state })` +
   `get` / `lazy` / `stat` / `has` / `put` / `remove` / `list` + `serveFile` на
   едином типе `File` / `LazyFile`) — попадает в то, что ты хотел по аналогии с
   `lib/image`, или что-то убавить/переименовать?
2. Включать ли сразу в `index.js` тонкую обёртку `receiveFiles` над
   `@remix-run/form-data-parser` для приёма потока от клиента, или пока оставить
   только `createStorage` + `serveFile` + `webdav`?
