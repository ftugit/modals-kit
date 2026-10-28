# План: `lib/storage` — поэтапная разработка

Заказ владельца. Этапы добавляются владельцем по мере продвижения: разбираем,
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
   - `/home/user/uploads/github-token.txt` не печатать и не коммитить; правило о
     кратких статусах только между крупными этапами сохранено в
     `/home/user/uploads/coding-agent-prompt.md` (`7debb53`).
3. **Точка остановки (`STOPPED AT`):** Этап 1 — повторное исследование с учётом
   замечаний владельца завершено, ожидается подтверждение выбранной кодовой базы
   стриминга и состава адаптеров Этапа 1.

---

## Состояние этапов по коммитам (обновлено 2026-10-28)

| Этап | Содержание | Состояние | Коммиты |
|---|---|---|---|
| **1. Стриминг в окружениях и базовые адаптеры `#lib/storage`** | Что умеют `Node`, `Bun`, `Vercel`, `Cloudflare` (+ SvelteKit), выбор готового кросс-рантайм модуля стриминга файлов, схема адаптеров (`webdav`, `local`, `r2`) | **На согласовании у владельца** | — |

---

# Этап 1. Возможности окружений, готовый модуль стриминга и адаптеры `#lib/storage`

## 1.1. Замечания и вводные владельца (2026-10-28)

1. **Не распыляться на будущие этапы:** сейчас только **один этап** — понять,
   что реально умеет окружение (`Cloudflare`, `Vercel`, `Node`, `Bun`) по
   потокам и как правильно писать адаптеры, чтобы стримить файлы в обе стороны
   (от клиента, из файлов самого приложения, из внешнего хранилища вроде WebDAV).
   Чанкование под мессенджеры и UI-этапы — **рано**, убраны из плана.
2. **Не изобретать своё низкоуровневое ядро стриминга:** найти готовый модуль /
   кодовую базу, которая даёт **одинаковый API стриминга файлов для Cloudflare,
   Vercel, Node и Bun** и уже закрывает платформенные подводные камни (пример:
   получаем файл с WebDAV — стримим его через `lib` без пожирания RAM).
3. **Реальные хранилища и стенд:**
   - для живых тестов сейчас у владельца есть **только WebDAV**;
   - хранение пользовательских файлов в RAM (`memory`) на проде бессмысленно из-за
     расхода памяти (максимум простейший фейк для юнит-тестов); локальное
     хранилище на диске сервера называть понятно — **`local`** (или `local-fs`);
   - раз у Vercel и Cloudflare нет локального диска функции, универсальным
     облачным бакетом на все случаи жизни делаем **Cloudflare R2** с отдельной
     схемой подключения под хост + `aws4fetch`, где он упрощает подпись.

---

## 1.2. Что само окружение (`Node`, `Bun`, `Vercel`, `Cloudflare` + SvelteKit) уже умеет и где подводные камни

Проверены исходники всех четырёх адаптеров SvelteKit (`@sveltejs/adapter-node`,
`@sveltejs/adapter-vercel`, `@sveltejs/adapter-cloudflare`,
`gornostay25/svelte-adapter-bun`) и `@sveltejs/kit/src/exports/node/index.js`.

### Что уже одинаково из коробки во всех 4 средах
Внутри серверного кода SvelteKit (`+server.ts`, `hooks.server.ts`) все 4
адаптера уже приводят платформу к **единому Web Fetch API**:
1. **Приём потока от клиента:** `request.body` — везде стандартный
   `ReadableStream<Uint8Array>`. В `adapter-node` (`getRequest`) уже написан
   мост над `http.IncomingMessage` с честным backpressure (`req.pause()` при
   заполнении буфера и `req.resume()` на `pull()`), очисткой недочитанного сокета
   (`#14916`/`#15526`) и отменой `request.signal` при обрыве соединения клиентом.
2. **Отдача потока клиенту:** `return new Response(readableStream, { headers })` —
   везде стримит чанками без склейки в память. В `adapter-node` (`setResponse`)
   уже реализовано ожидание `res.once('drain')` и автоматический
   `reader.cancel()` при закрытии вкладки браузера.
3. **Стриминг файлов самого приложения (входящих в сборку):** в SvelteKit уже
   встроен универсальный помощник **`read(assetUrl)` из `$app/server`**, который
   каждый адаптер под капотом маппит на свой нативный стрим:
   - `adapter-node` и `adapter-vercel` → `Readable.toWeb(fs.createReadStream(...))`;
   - `svelte-adapter-bun` → `Bun.file(...).stream()`;
   - `adapter-cloudflare` → `(await env.ASSETS.fetch(url)).body`.

### Платформенные подводные камни (почему голого `fetch` / `Response` недостаточно)

| Среда | Подводный камень (найден в исходниках рантаймов/адаптеров) | Как обходится |
|---|---|---|
| **Все 4 среды (ловушка `res.blob()`)** | Если сделать `const blob = await (await fetch(webdavUrl)).blob()`, рантайм **выкачивает весь файл с WebDAV в RAM сервера целиком** до отправки первого байта клиенту. Три юзера с файлами по 100 МБ = +300 МБ RAM (на Cloudflare Worker с лимитом 128 МБ — мгновенный крэш). | Не вызывать `.blob()` / `.arrayBuffer()` на сетевом ответе! Оборачивать `res.body` (`ReadableStream`) в ленивый `LazyFile` (см. п. 1.3) или пробрасывать `res.body` напрямую. |
| **Node (`adapter-node`) и Bun (`svelte-adapter-bun`)** | В обоих адаптерах по умолчанию зашито **`BODY_SIZE_LIMIT = '512K'`** (`512 КБ`)! Любая загрузка файла `> 512 КБ` падает с `413 Payload Too Large`. В `svelte-adapter-bun` ещё стоит `IDLE_TIMEOUT = 10` сек. | На деплое Node/Bun задавать `BODY_SIZE_LIMIT` (например `100M` или `Infinity` при потоковом парсере со своим лимитом) и `IDLE_TIMEOUT` для долгих загрузок. |
| **Node и Vercel (`undici` `fetch`)** | Вызов `fetch(url, { method: 'PUT', body: readableStream })` для отправки потока в WebDAV/R2 **падает с `TypeError`**, если не передать нестандартное поле **`duplex: 'half'`**. Плюс в Node `< 24.20` вызов нативного `blob.stream()` никогда не освобождает память (`nodejs/node#63574`). | Всегда передавать `duplex: 'half'` в исходящий потоковый `fetch`; для нативных `Blob` использовать нарезку `blob.slice()` (уже встроено в пакеты `@remix-run/*` ниже). |
| **Cloudflare Workers** | 1) Жёсткий потолок **128 МБ RAM** на изолят. 2) Исходящий `fetch(url, { method: 'PUT', body: stream })` требует заранее известный **`Content-Length`** (либо `FixedLengthStream`), иначе Worker или WebDAV-сервер (`411 Length Required`) отклонит поток. 3) Локального диска нет. | Передавать `size` (`Content-Length`) вместе с потоком; для R2 внутри Cloudflare использовать прямой binding `env.BUCKET` (`R2Bucket`), минуя лишний HTTP-круг. |
| **Vercel** | Платформа на входе режет тело запроса к функции на **4.5 МБ (`413 FUNCTION_PAYLOAD_TOO_LARGE`)** до запуска SvelteKit. Выходящий стрим (`Response(stream)`) этим лимитом не режется (ограничен только таймаутом функции). Локального диска нет (`/var/task` read-only). | Отдавать любые файлы можно стримом или редиректом на подписанный URL R2; а **загружать файлы `> 4.5 МБ` на Vercel** нужно прямой отправкой из браузера в R2 по `presignPut` (или чанками `< 4 МБ`). |

---

## 1.3. Найденная готовая кросс-рантайм кодовая база стриминга файлов: `@remix-run/lazy-file` + `@remix-run/response` + `@remix-run/fs` + `@remix-run/form-data-parser`

В экосистеме нашёлся именно тот набор маленьких автономных пакетов (MIT,
репозиторий `remix-run/remix`, автор Michael Jackson, опубликованы в npm как
независимые Web-пакеты **без единой зависимости от React или Remix**), который
создан специально как **единый файлово-потоковый слой для Cloudflare Workers,
Vercel, Node и Bun**:

| Пакет в npm (актуальный релиз) | Размер / Зависимости | Что делает и какие подводные камни закрывает за нас |
|---|---|---|
| **`@remix-run/lazy-file@5.0.8`** (MIT) | 56 КБ, только `@remix-run/mime` | Даёт классы **`LazyFile` и `LazyBlob`**, полностью совместимые со стандартным Web `File` (`name`, `size`, `type`, `lastModified`, `.stream()`, `.slice(start, end)`), но **без хранения байтов в RAM**. Внутри — интерфейс `LazyContent { byteLength, stream(start, end) }`. Нативный `Blob`, файл с диска, файл из WebDAV и файл из R2 становятся **одним и тем же типом `File`**. |
| **`@remix-run/response@1.0.1`** (MIT) | 80 КБ (`headers`, `mime`), **57 КБ автотестов** | Готовая функция **`createFileResponse(file, request, options)`**: берёт любой `File` или `LazyFile` и отдаёт правильный потоковый `Response` в любом из 4 рантаймов. Из коробки решает все тонкости RFC 9110: `Range` → `206 Partial Content` через `file.slice(start, end + 1).stream()` (перемотка видео/аудио и докачка!), `416 Range Not Satisfiable`, `If-Range`, `ETag` (`weak` по размеру+дате без чтения файла в память!), `If-None-Match` → `304`, `If-Modified-Since`, `HEAD` без открытия стрима, отключение `Accept-Ranges` на сжимаемых текстовых типах и `X-Content-Type-Options: nosniff`. |
| **`@remix-run/fs@1.0.0`** (MIT) | 13 КБ (`lazy-file`, `mime`) | Готовая связка для локального диска в **Node и Bun**: `openLazyFile(path)` открывает файл с диска как `LazyFile` с честным побайтовым `Range` (`createReadStream(p, { start, end: end - 1 })`), а `writeFile(path, file)` пишет любой `{ stream() }` на диск с обработкой `drain` backpressure и уничтожением дескриптора при ошибке. |
| **`@remix-run/form-data-parser@1.1.0`** (MIT) | 69 КБ (`multipart-parser`, `headers`) | Потоковый разбор входящей загрузки от клиента `parseFormData(request, uploadHandler)`: файл течёт из `request.body` сразу в наш адаптер (`webdav` / `r2` / `local`) чанками по 64 КБ **без буферизации в RAM**, и внутри уже встроен обход утечки памяти `Blob#stream()` в Node `< 24.20` (`nodejs/node#63574`). |
| **`aws4fetch@1.0.20`** (MIT) | 65 КБ, **0 зависимостей** | Подпись запросов AWS SigV4 и генерация `presignGet` / `presignPut` поверх штатных `fetch` + `crypto.subtle` во всех 4 средах (идеален для Cloudflare R2 по HTTP). |

*(Примечание: пакет `@remix-run/file-storage-s3` брать готовым не стоит — как
показала проверка его `s3.ts:282`, внутри `get()` там написано `await
response.arrayBuffer()`, что убивает стриминг на чтении. А вот базовые примитивы
`lazy-file` + `response` + `fs` + `form-data-parser` написаны образцово — без
единой полной буферизации.)*

---

## 1.4. Разбор на твоём примере: как через эту связку стримится файл с WebDAV, от клиента и из приложения

Единая валюта во всём `lib/storage` — стандартный **`File` (`File | LazyFile`)**:

### Сценарий 1. Чтение файла с WebDAV и отдача его клиенту стримом (видео / скачивание)
1. Адаптер `webdav` делает лёгкий `HEAD` к WebDAV (получает `Content-Length`,
   `Content-Type`, `Last-Modified` — это ~200 байт заголовков, **тело не качается**)
   и возвращает **`LazyFile`**:
   ```ts
   const lazyFile = new LazyFile(
     {
       byteLength: size,
       stream(start = 0, end = size) {
         // Качаем с WebDAV ТОЛЬКО запрошенный кусок, сразу потоком res.body!
         // Никакого res.blob() в оперативной памяти!
         return fetchWebdavRangeStream(url, authHeader, start, end - 1, signal);
       }
     },
     fileName,
     { type: contentType, lastModified }
   );
   ```
   *(А если где-то в коде реально уже оказался готовый мелкий `Blob` или `File` —
   например, после сжатия картинки в памяти — он тоже подходит без конвертации!)*
2. В серверном роуте (на Node, Bun, Vercel или Cloudflare — код **один и тот же**)
   вызывается одна строка из `@remix-run/response`:
   ```ts
   return createFileResponse(lazyFile, request, { cacheControl: 'private, max-age=3600' });
   ```
   - Если браузер сделал `HEAD` или у него совпал `ETag` (`304`) — `stream()` у
     WebDAV **даже не вызовется** (0 байт трафика).
   - Если `<video>` перемотали на середину (`Range: bytes=10485760-`) —
     `createFileResponse` сам вызовет `lazyFile.slice(10485760, size).stream()`,
     WebDAV отдаст `206` ровно с 10-го мегабайта, и чанки транзитом улетят в
     браузер с расходом RAM в десятки килобайт!

### Сценарий 2. Поток от клиента → сразу в WebDAV / R2 / локальный диск
```ts
await parseFormData(request, async (fileUpload) => {
  // fileUpload — уже потоковый File: пишем его стрим напрямую в выбранный адаптер
  await storage.put(key, fileUpload, { signal: request.signal });
  return key;
});
```
Внутри `webdav.put(key, file)` идёт `fetch(url, { method: 'PUT', body: file.stream(), duplex: 'half', headers: { 'Content-Length': String(file.size) } })` — байты текут из сокета браузера прямо в сокет WebDAV.

### Сценарий 3. Стриминг файла из самого приложения
- **Динамические файлы на локальном диске сервера (Node и Bun):** адаптер `local`
  вызывает `openLazyFile(fullPath)` из `@remix-run/fs` → тот же `LazyFile` → тот
  же `createFileResponse(file, request)`.
- **Статические/встроенные в билд файлы приложения (работает и на Vercel, и на Cloudflare, и на Node/Bun):**
  тонкий хелпер в `src/lib/storage/sveltekit/` берёт `read(asset)` из
  `$app/server` и отдаёт поток (или при известном размере — `LazyFile`).

---

## 1.5. Как тогда устроен наш тонкий `src/lib/storage` на Этапе 1

Вместо написания своего велосипеда для потоков, `Range`, `ETag`, `fs`-бэкпрешера
и multipart-парсинга мы опираемся на `@remix-run/lazy-file`,
`@remix-run/response`, `@remix-run/fs`, `@remix-run/form-data-parser` и
`aws4fetch`.

На долю самого `src/lib/storage` остаётся **тонкая адаптация источников** (как в
`src/lib/paginate/source.ts`: `defineStorageSource` + модульный бренд +
`capabilities` + защита ключей от `../`):

1. **Ядро связки (`src/lib/storage/index.ts`):**
   - `defineStorageSource` / `AdaptedStorageSource` (методы `get(key) -> Promise<File | null>`,
     `put(key, file, opts)`, `has(key)`, `remove(key)`, опционально `list`,
     `presignGet`, `presignPut`);
   - реэкспорт / тонкая обёртка `serveFile(file, request, opts)` над
     `createFileResponse` из `@remix-run/response` (с добавлением удобного
     заголовка `Content-Disposition` для русских имён файлов по RFC 5987);
   - нормализация ключей (`key.ts` — запрет `..`, `\0`, обратных слэшей);
   - крошечный `memory` на `Map<string, File>` (~25 строк) **только для
     изолированных юнит-тестов**.
2. **Адаптер `webdav.ts` (`#lib/storage/webdav.js`) — главный живой пилот:**
   - работает поверх чистого `fetch` во всех 4 средах (`Node`, `Bun`, `Vercel`,
     `Cloudflare`);
   - умеет `Basic` / `Bearer` авторизацию, ленивое чтение через `LazyFile` +
     `Range`, потоковый `PUT` (с `duplex: 'half'`, `Content-Length` и опциональным
     созданием подпапок `MKCOL`), `HEAD`, `DELETE` и `PROPFIND Depth: 1`;
   - **проверяется не только моками, но и на реальном WebDAV владельца**.
3. **Адаптер `local.ts` (`#lib/storage/local.js`) — локальные файлы сервера (Node / Bun):**
   - тонкая безопасная обёртка вокруг `@remix-run/fs` (`openLazyFile` + атомарная
     запись во временный файл + `rename` внутри корневой папки `rootDir`).
4. **Адаптер `r2.ts` (`#lib/storage/r2.js`) — Cloudflare R2 с двумя схемами под хост:**
   - **`r2HttpSource(...)` (на `aws4fetch`):** для Node, Bun, Vercel и внешних
     хостов — честный `LazyFile` с `Range` на чтении, потоковый `PUT` / Multipart
     Upload на записи и `presignGet` / `presignPut` (чтобы на Vercel обходить
     лимит 4.5 МБ прямой загрузкой в R2);
   - **`r2BindingSource(env.BUCKET)`:** нативная схема специально для хостинга
     на Cloudflare Workers (напрямую через `R2Bucket.get(key, { range })` и
     `R2Bucket.put`, 0 сетевых накладных расходов на подпись).
5. **Мостик `sveltekit/asset.ts` (`#lib/storage/sveltekit/asset.js`):**
   - чтение файлов, упакованных в саму сборку SvelteKit (`$app/server` `read`),
     с соблюдением `tooling/core-purity.mjs`.

---

## 1.6. Вопросы на подтверждение Этапа 1

1. **Готовая база стриминга:** берём связку **`@remix-run/lazy-file` +
   `@remix-run/response` + `@remix-run/fs`** (+ `aws4fetch` для R2 HTTP, а для
   приёма multipart с клиента — `@remix-run/form-data-parser`) как единый
   проверенный фундамент потоков для Cloudflare, Vercel, Node и Bun?
2. **Состав адаптеров Этапа 1:** делаем именно этот набор:
   - **`webdav`** (с возможностью сразу прогнать интеграционный тест на твоём
     реальном WebDAV — через переменные окружения в `.env`, не попадающие в Git);
   - **`local`** (локальная папка на диске для Node/Bun);
   - **`r2`** в двух режимах под хост (`r2HttpSource` на `aws4fetch` для
     Vercel/Node/Bun + `r2BindingSource` для воркера Cloudflare);
   - плюс тонкий `sveltekit`-хелпер для стриминга файлов из самой сборки
     приложения (`$app/server` `read`)?
3. **Проверка на твоём WebDAV:** когда перейдём к коду, какие особенности у
   твоего тестового WebDAV (Nextcloud, Яндекс.Диск, Nginx/Apache или свой сервер;
   обычный `Basic`-токен/пароль)? Это поможет сразу учесть нюансы его `PROPFIND`
   и `MKCOL`.
