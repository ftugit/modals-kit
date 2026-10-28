# План: `lib/storage` и раздел сайта «Файлы» (этапы 1–7)

Заказ владельца: написать независимую от приложения библиотеку `#lib/storage`
для потокового чтения и записи файлов в разных средах и облаках (включая S3,
WebDAV и неофициальные источники вроде Telegram-ботов и Discord), а поверх неё
построить раздел сайта «Файлы» и закрыть файловые хвосты проекта.

Принцип работы с документом (по образцу `docs/plan-seed-list-stages.md`):
- сверху — сводная таблица всех этапов и краткие контуры будущих этапов;
- детально исследуется, обсуждается и утверждается **только текущий этап**
  (сейчас — **Этап 1**);
- ответы и замечания владельца записываются прямо в раздел этапа;
- код пишется **только по явной команде владельца** после согласования этапа;
- по завершении реализации в том же этапе фиксируются отчёт, коммиты и гейты —
  файл служит и чек-листом, и историей решений, и якорем между сжатиями
  контекста или новыми чатами.

---

## ПРОЦЕДУРА (для продолжения после обрыва / сжатия контекста)

### Пять жёстких правил (`<hard_rules>`)
1. **Ни одной правки до VCS.** Перед первой записью в дереве проверить
   `git rev-parse --is-inside-work-tree` и чистоту `git status --porcelain`
   (перед правкой > 3 файлов при грязном статусе — сначала `wip:`-коммит).
2. **Коммит обязателен сразу после зелёного гейта**, когда изменены файлы вне
   `/tmp` — по наблюдаемому результату проверки, а не по самооценке.
3. **Запрет на «сделано / работает / исправлено» без заполненного
   `<evidence_block>`** (`GIT`, `GATES`, `SKIPPED`).
4. **Любое невыполненное требование называется вслух** в ответе и в `SKIPPED`.
5. **После любого замечания / корректировки владельца — стоп:** ответить,
   дождаться решения, не редактировать файлы, пока решение не принято.

### Состояние VCS и среды
- **Дерево проекта:** `/home/user/projects/modals-kit`, ветка `img`
  (базовый коммит клона: `693f9a3`).
- **Удалённый `origin`:** `https://github.com/ftugit/modals-kit.git` сохранён
  локально для чтения истории; **пуш не выполняется** без явной команды
  владельца. Все коммиты локальные.
- **Среда и зависимости:** в контейнере сейчас `/usr/bin/node v20.20.2`, а
  `vite.config.ts` и `AGENTS.md` требуют **Node.js `>= 22.17`** и `--no-liftoff`
  для воркеров PGlite. Перед первым кодовым этапом поставить Node 22 в
  `/usr/local/bin` и выполнить `npm ci`. Playwright `1.64.1`
  (`chromium-headless-shell`) установлен и проверен.
- **Секреты:** `/home/user/uploads/github-token.txt` никогда не печатать в
  вывод, не логировать и не коммитить; в снапшотах песочницы `.git/config`
  исключён (при пересоздании контейнера восстановить базовую секцию `[core]`).
- **Точка остановки (`STOPPED AT`):** Этап 1 — исследование и проект архитектуры
  записаны ниже; **код не начат**, ожидаются ответы владельца по открытым
  вопросам Этапа 1 (раздел 1.7).
- **Пропущенные на данном шаге правила кодовых этапов:** `svelte-check`,
  `vitest`, `vite build` и браузерные пробы не запускались, так как в этом шаге
  добавлен только плановый документ `docs/plan-files-stages.md` без изменений
  исходного кода (проверен страж `node tooling/public-api.mjs`).

---

## Состояние этапов по коммитам (обновлено 2026-10-28)

| Этап | Содержание | Состояние | Коммиты |
|---|---|---|---|
| **1. Ядро `#lib/storage` и базовые источники** | Независимая библиотека на Web Streams (`ReadableStream`, `Range`), адаптация и композиция источников по канону `lib/paginate`, базовые адаптеры (`memory`, `node-fs`, `s3`, `webdav`) | **Исследование готово, ждёт решений владельца** | — |
| **2. Чанкование и аддоны облаков-мессенджеров** | Декоратор `withChunking` (манифест кусков, потоковый `SHA-256`, склейка `Range`) + источники-аддоны `telegram-bot` и `discord` + связки `#hooks` (`#lib/fetch`, `#lib/cache`) | Не начат | — |
| **3. Потоковый приём/раздача на сервере и хвосты P1 (`docs/pending.md`)** | Потоковый разбор multipart без буферизации тела в RAM (`@remix-run/multipart-parser`), брендированный `PreparedFile`, GET-раздача с `206 Partial Content`/`ETag`, перевод `avatar_url` с `data:` на URL хранилища | Не начат | — |
| **4. Домен и модели `#content/files` (`#lib/db` + ACL)** | Таблицы файлов и манифестов в `#lib/db`, политики доступа (`private` / `members` / `public`, роли), квоты, soft-delete, доменные порты | Не начат | — |
| **5. Компоненты загрузки и карточек файлов** | Форма загрузки (`defineForm` + `bindComponentForm` + `FileAttachment` multiple), выбор/маршрутизация хранилища, удаление и переименование (JS + no-JS) | Не начат | — |
| **6. Раздел сайта «Файлы» (`/files` + модалки)** | Конечный самодостаточный список файлов (канон `SeedUsersList`: пагинатор, поиск, фильтры, `rowAttrs`), карточка/модалка файла с потоковым предпросмотром видео/аудио/картинок и скачиванием, пункт в `NAV_ITEMS` | Не начат | — |
| **7. Перенос между источниками и зачистка** | Админ-операции переноса файла между облаками (например, `fs`/`s3` ↔ `telegram`/`webdav`), фоновая дочистка удалённых файлов и сиротских чанков | Не начат | — |

---

## Контуры этапов 2–7 (ориентиры, детализируются перед стартом каждого)

### Этап 2. Декоратор чанкования и неофициальные источники (`telegram-bot`, `discord`)
Подключение облаков с жёстким лимитом на одно сообщение/файл и протухающими
ссылками скачивания: разбиение входного потока на части (`≤ 19 МиБ` для
Telegram Bot API, `≤ 9 МиБ` для Discord), хранение манифеста кусков, обновление
временных URL через `#lib/cache` и ограничение скорости API через `#lib/fetch`
(переходники в `src/hooks/`), прозрачная отдача любого `Range` склейкой только
затронутых чанков.

### Этап 3. Серверный конвейер файлов и закрытие P1 из `docs/pending.md`
Уход от `request.formData()` целиком в памяти к потоковому multipart-приёму в
`#lib/storage`, ввод брендированного `PreparedFile` (`docs/design/image-transfer.md`
R7), кэшируемый серверный роут выдачи байтов (`Range` / `206` / `ETag` / `304`),
перевод `user_profile.avatar_url` с `data:image/...` на URL и сохранение
тонкой куки `auth_tmp` (R6).

### Этап 4. Модель файлов и ACL (`src/content/files/`)
Ресурсы `#lib/db` для пользовательских файлов: владелец (`auth_id`), локатор
хранилища (`backend + key` либо манифест кусков), имя, MIME, размер, `sha256`,
уровень видимости (`private` / `members` / `public` по образцу плана приватности
профиля), `deleted_at` и проверка прав перед отдачей потока.

### Этап 5. Формы загрузки и действий над файлами
Маршрутно-независимые компоненты загрузки (`bindComponentForm`), интеграция с
существующим `FileAttachment` (`row` / `tile` / `strip`, накопление `multiple`),
прогресс задачи в `LoaderBar` (`#lib/task`), подтверждение удаления (`HoldButton`
или модалка), полный no-JS путь.

### Этап 6. Раздел сайта «Файлы» (`/files`, модалки `files.*`)
Самодостаточный компонент списка файлов (по канону `SeedUsersList` и `Profile`:
носители — только `<Acl />`, данные — одна точка `load` `/files`), поиск по
имени/типу, фильтры (тип медиа, размер, источник хранения, дата, видимость),
просмотр и потоковое воспроизведение медиа в модалке и на странице `/files/[id]`.

### Этап 7. Миграция между облаками и сборка мусора
Потоковое копирование/перенос между любыми двумя адаптированными источниками
`lib/storage` без выгрузки в память и исполнитель зачистки удалённых объектов
(по аналогии со `sweepDeletions` у `user`).

---

# Этап 1. Независимая библиотека `#lib/storage` — исследование и проект

## 1.1. Что уже есть в проекте (опора и ограничения репозитория)

1. **Эталон архитектуры связки источников — `src/lib/paginate/source.ts` + `src/lib/modals/core-contract.ts`:**
   - Пагинатор сам не ходит ни в БД, ни в REST/GraphQL: он принимает **только
     адаптированный источник** с модульным брендом `Symbol` (`defineSource` →
     `assertAdaptedSource`).
   - Каждый источник явно объявляет `capabilities` (а чего не объявляет —
     отсекается на слое deny-safe и честно видно потребителю через гейты).
   - Недостающее поведение навешивается иммутабельными декораторами `.with(...)`
     (`decorateSource`, `withLibSearch`, `withTotalsGate`), а несколько разных
     источников собираются в один через `composeSources(variants, { select })`.
   - **Прямой перенос на `#lib/storage`:** хранилище так же не обязано само
     знать тонкости S3 XML, WebDAV или лимитов Telegram — ядро задаёт
     брендированный контракт источника байтов, переговоры о возможностях,
     нормализацию ключей/диапазонов `Range` и декораторы (чанкование, префиксы,
     маршрутизация между облаками).
2. **Правила границ слоёв (`AGENTS.md`, `tooling/core-purity.mjs`, `tooling/layer-guard.mjs`, `tooling/public-api.mjs`):**
   - `src/lib/storage` — пакет 1-го слоя (`#lib/storage/*`) со своим
     `entrypoints.json` и обязательным `src/lib/storage/README.md`.
   - Внутри `src/lib/storage` **запрещены** импорты `svelte`, `@sveltejs/kit`,
     `$app/*`, `$env/*`, верхних слоёв и соседних пакетов `#lib/*` (`#lib/fetch`,
     `#lib/cache`, `#lib/db`).
   - Чтобы переиспользовать `#lib/fetch` (ретраи, `Retry-After`, лимиты `rps`/`rpm`
     для Telegram/Discord/WebDAV) и `#lib/cache` (кэш временных ссылок и `singleflight`),
     источники `lib/storage` принимают **структурные зависимости в опциях**
     (`fetch?: typeof globalThis.fetch`, `cache?: StorageUrlCache`,
     `manifest?: ChunkManifestStore`), а конкретные экземпляры из `#server/*`
     подключаются в `src/hooks/` или `src/server/storage.server.ts`. Библиотека
     остаётся на 100% переносимой в любой другой проект (включая React/Hono).
3. **Уже записанные в репозитории требования к будущему `lib/storage`:**
   - `docs/pending.md` (§1, **P1**): отказ от буферизации всего тела в память,
     работа с потоками чанками (ориентир части — 8 МиБ), хранение URL вместо
     `data:` в `user_profile.avatar_url`.
   - `docs/design/image-transfer.md` и шапка `src/content/user/auth.ts`: байты
     аватара никогда не кладутся в куку `auth_tmp`; проверка заголовков картинок
     без декодирования уже есть в `#lib/image/probe.js`.

---

## 1.2. Аудит готовых библиотек (проверено по исходникам на GitHub, 2026-10-28)

Проверено главное: можно ли не писать свою связку, а взять готовую библиотеку
или тонкую обёртку над Node-модулем.

| Библиотека | Версия / Лицензия | Стриминг и `Range` (по коду) | Среды (`Node`, `Bun`, `Vercel`, `CF Workers`) | Поддержка источников и критические ограничения |
|---|---|---|---|---|
| **`unjs/unstorage`** | `2.0.0-beta.0` / `1.17.6`, MIT (2.6k★) | **Нет честного стриминга.** В `2.0.0-beta.0` появился `getItem(k, { type: 'stream' })`, но в `src/storage.ts` он зовёт `driver.getItemRaw`, а `src/drivers/s3.ts` делает `res.arrayBuffer()` — **весь файл целиком грузится в RAM**. Запись в S3 — только `PUT` буфера/строки (нет Multipart Upload). **`Range` нет.** | Node, Bun, Vercel, CF Workers | KV-хранилище, а не файловое: нет `Range`/`206`, нет WebDAV-драйвера, текстовые драйверы молча оборачивают бинарник в `base64:`. На файле 150 МБ роняет CF Worker (лимит 128 МБ RAM). |
| **`@flystorage/file-storage`** (`duna-oss/flystorage`) | `1.2.2`, в корне репо SPDX `None` (310★) | Потоки есть, но **на `node:stream.Readable`**. В `StorageAdapter.read(path)` **нет параметра `range`** (нельзя отдать срез байтов для видео/докачки без чтения с нуля). | Node, частично Bun; **не чистый Edge/Workers** (`crypto`, `node:stream`, `util`) | `@flystorage/aws-s3` тянет тяжёлый `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` + `file-type`. Нет встроенного WebDAV, нет чанкования под мессенджер-облака. |
| **`@flydrive/core`** (`flydrive-js/core`) | `2.1.0`, MIT (182★) | Лучший из Node-пакетов: есть `getStream(key, { range: { start, end } })`, `putStream`, `getMetaData`, `getSignedUrl`. | **Только Node-потоки** (`import { Readable } from 'node:stream'`) + `@poppinss/utils` | Жёсткая привязка контракта к `node:stream.Readable` вместо Web `ReadableStream`; S3-драйвер на тяжёлом `@aws-sdk/client-s3`; нет WebDAV; нет модели чанкованных/квитанционных источников (Telegram/Discord). |
| **`@remix-run/file-storage` + `file-storage-s3` + `lazy-file`** | `1.0.0` / `1.1.0`, MIT | Запись в S3 — отличная: потоковый Multipart Upload на `aws4fetch` (держит в RAM ≤ 2 частей по 8 МиБ). **Но чтение (`get`) в `s3.ts` (стр. 282) делает `await response.arrayBuffer()`** — целиком буферизует S3-объект в память и не поддерживает `Range`! | Node, Bun, Vercel, CF Workers (чистые Web API) | Есть только `memory`, `fs` и `s3`. Нет потокового `Range`-чтения из S3, нет WebDAV, нет presigned URLs, нет переговоров о возможностях. Ценная находка из их `s3.ts`: в Node < 24.20 `Blob#stream()` течёт по памяти (`nodejs/node#63574`) — обходится нарезкой через `blob.slice()`. |
| **`apache/opendal`** (`bindings/nodejs`) | `0.49.13`, Apache-2.0 (5.4k★) | Полноценный стриминг и `Range` в Rust-ядре, десятки бэкендов (S3, WebDAV, FS и др.). | Node (через нативный **N-API `.node` бинарник**); **не работает в CF Workers** и Edge | Нативный платформозависимый бинарник несовместим с изолятами Cloudflare Workers и утяжеляет serverless-деплой. |
| **`perry-mitchell/webdav-client`** (`webdav`) | `5.11.0`, MIT (816★) | Умеет `createReadStream`/`getFileContents` с `Range`, `putFileContents`, `stat`, `getDirectoryContents`. | Ориентирован на Node + браузер, но тянет 15 зависимостей (`node-fetch`, `url-parse`, `hot-patcher`, `layerr`, `fast-xml-parser`) | Ради 5 HTTP-методов WebDAV (`GET`, `PUT`, `HEAD`, `DELETE`, `MKCOL`, `PROPFIND`) тащить 15 старых пакетов с `node-fetch` нецелесообразно — чистый `fetch`-адаптер занимает ~120 строк без зависимостей. |

### Вывод по выбору основы
1. **Просто обернуть один Node-модуль (`node:fs`, `flydrive` или `flystorage`) нельзя:**
   - контракты на `node:stream.Readable` чужеродны для Web `Request`/`Response`,
     SvelteKit, Cloudflare Workers и Bun;
   - готовые Web-библиотеки (`unstorage`, `@remix-run/file-storage-s3`) при чтении
     делают `response.arrayBuffer()`, ломая стриминг крупных файлов и `206 Partial Content`;
   - ни одна библиотека не даёт единого слоя адаптации, где ключевое хранилище
     (S3/WebDAV/FS) и чанкованное квитанционное хранилище (Telegram/Discord)
     работают через один и тот же потоковый контракт с `Range`.
2. **Что берём готовым, чтобы не писать велосипеды:**
   - **`aws4fetch` (`^1.0.20`, MIT, ~4 КБ, 0 зависимостей)** — стандарт де-факто
     (используется и в `unstorage v2`, и в `@remix-run/file-storage-s3`) для
     подписи AWS SigV4 поверх Web `fetch` + `crypto.subtle`. Даёт единый лёгкий
     клиент для AWS S3, Cloudflare R2, MinIO, Backblaze B2, Yandex Object Storage,
     Garage во всех четырёх средах (`Node`, `Bun`, `Vercel`, `Cloudflare`) без
     многомегабайтного `@aws-sdk/client-s3`.
   - Веб-стандарт **`ReadableStream<Uint8Array>`** как единственная валюта потоков
     ядра (на границе с `node:fs` в `node.ts` конвертируется штатным
     `Readable.toWeb` / `Readable.fromWeb`, встроенным в Node 22+ и Bun).

---

## 1.3. Можно ли хранить файлы «прямо в приложении»? Матрица сред

| Среда | Локальное хранение в приложении | Жёсткие лимиты рантайма | Как читать / писать файлы |
|---|---|---|---|
| **Node.js (`>= 22.17`)** (VPS, Docker, выделенный сервер) | **Да, полноценно** — в папке на диске/томе вне `build/` (например `STORAGE_DIR=./data/storage`). Деплой код не затирает. | Диск сервера; при нескольких репликах нужен общий том (NFS) или внешнее облако. В Node < 24.20 `Blob#stream()` удерживает буферы (`node#63574`) — резать `Blob` через `slice()`. | Локальный источник `node-fs` (стрим чтения с `{ start, end }`, атомарная запись во временный файл + `rename`) **плюс** любые внешние источники (S3, WebDAV, Telegram, Discord). |
| **Bun** (VPS, Docker) | **Да, полноценно** — та же папка на диске. | Совместим с `node:fs` и Web Streams; дополнительно умеет нативный `Bun.file(p).slice(a, b).stream()`. | Тот же адаптер `node-fs` (работает в Bun без правок) или все `fetch`-источники (`s3`, `webdav`, `telegram`, `discord`). |
| **Vercel** (Serverless / Edge) | **Нет.** Каталог сборки (`/var/task`) — **read-only**. `/tmp` (до 500 МБ) **эфемерный**: стирается при остывании инстанса и не виден соседним запросам. | **Лимит тела запроса функции — 4.5 МБ** (`413 FUNCTION_PAYLOAD_TOO_LARGE` режется краем Vercel до кода приложения). Память 1–3 ГБ, но время ответа ограничено. | Хранить **только во внешних источниках** (`s3` / R2 / `vercel-blob` / `webdav` / `telegram` / `discord`). Раздача: `presignGet` (S3/R2/Vercel Blob) либо серверный `Response(stream)`. Загрузка `> 4.5 МБ`: либо прямая клиентская загрузка по `presignPut`, либо чанкованная отправка с клиента кусками `≤ 4 МБ`! |
| **Cloudflare Workers / Pages** | **Нет.** Персистентной ФС нет (`node:fs` в `nodejs_compat` живёт только в памяти одного запроса). | **Память изолята — 128 МБ RAM.** Буферизация файла `> 50–100 МБ` через `arrayBuffer()` убивает воркер по OOM. | Только сквозной стриминг `ReadableStream` во внешние источники: нативный **R2 binding** (`env.BUCKET`) или `s3` (`aws4fetch`), `webdav`, `telegram`, `discord`. |
| **PostgreSQL / PGlite (`#lib/db`)** | Технически можно `bytea` только для мелочи (`< 100 КБ`), **не годится** как основное файловое хранилище раздела «Файлы». | Раздувает WAL/бэкапы, драйвер `pg` держит строку в RAM целиком, быстро выжирает бесплатные лимиты облачных БД. | В БД храним **только метаданные файлов, права ACL и JSON-манифесты чанков** (для Telegram/Discord), а сами байты — в `lib/storage`. |

**Короткий ответ:** хранить файлы прямо на диске приложения **можно и удобно в
self-hosted Node и Bun** (и в dev-режиме), но **невозможно на Vercel и
Cloudflare** (кроме статических файлов, закоммиченных в Git до сборки). Поэтому
локальный диск — просто один из источников `lib/storage` (`node-fs`), а
переключение между `node-fs`, `s3`, `r2`, `webdav` и мессенджер-облаками не
должно менять ни строчки в коде приложения.

---

## 1.4. Что требуют неофициальные облака (Telegram Bot, Discord) от контракта Этапа 1

Проверены реальные реализации облачных дисков поверх Telegram и Discord на
GitHub (`DiscVault`, `tgDrive`, `teldrive`):

1. **Telegram Bot API (`api.telegram.org`):**
   - Отправка `sendDocument` принимает до **50 МБ**, но **скачивание через
     штатный `getFile` жёстко ограничено 20 МБ** на один `file_id` (потолок 2 ГБ
     доступен только при установке собственного C++ демона `telegram-bot-api --local`,
     недоступного на Vercel/Workers). Значит, файлы `> 19 МиБ` обязаны резаться
     на чанки **по 19 МиБ**.
   - `file_id` постоянен, но `file_path`, возвращаемый `getFile`, временный
     (~1 час), а ссылка скачивания содержит секрет бота:
     `https://api.telegram.org/file/bot<BOT_TOKEN>/<file_path>`.
     **Следствие по безопасности:** источник Telegram **никогда не имеет права**
     объявлять `presignGet` / `publicUrl` (иначе токен бота утечёт в браузер);
     байты отдаются **только серверным стримом**, а пара `file_id → file_path`
     кэшируется на ~45 минут.
   - У Telegram жёсткие лимиты частоты (`~20 сообщ./мин` в один канал/чат, `429
     retry_after`) — транспорт обязан пропускаться через ограничитель (`#lib/fetch`).
2. **Discord Bot / Webhook:**
   - Лимит одного вложения на бесплатном сервере — **10 МБ** (безопасный чанк —
     **9 МиБ** сырым бинарным `.bin` без base64-наценки +33%).
   - С конца 2023 г. ссылки `cdn.discordapp.com/attachments/...` содержат
     параметры `ex`/`is`/`hm` и **протухают через ~24 часа**. Хранить сам URL
     нельзя — в манифесте хранятся `{ channelId, messageId, attachmentId }`, а
     свежие CDN-ссылки обновляются пачкой через Discord API
     (`POST /api/v9/attachments/refresh-urls` или чтение сообщения) и кэшируются
     до `ex`.
3. **Фундаментальное отличие от S3 / FS / WebDAV:**
   - В S3, FS и WebDAV ключ задаёт **вызывающий** (`put('2026/cat.mp4', stream)`),
     файл лежит единым куском, есть `list(prefix)` и нативный `Range`.
   - В Telegram и Discord хранилище — **кассетное (chunk/receipt store)**: на
     запись куска оно возвращает **выданный провайдером ID** (`file_id` или
     `messageId`), не умеет искать по нашим путям `2026/cat.mp4` без индекса и
     требует манифеста чанков `[{ index, size, sha256, ref }]`, чтобы собрать
     большой файл обратно и отдать `Range: bytes=50000000-51000000` (скачав
     **только чанк №2**, а не все 2 ГБ с начала!).

**Как это ложится на идею `lib/paginate`:**
Чтобы S3 и Telegram-бот для приложения выглядели **абсолютно одинаково**, ядро
`#lib/storage` разводит два уровня ровно как `paginate/source.ts`:
- **Адаптированный источник (`AdaptedStorageSource`)** — единый фасад чтения
  (включая `range`), записи потока, проверки/метаданных и удаления.
- **Декоратор `withChunking({ partBytes, manifest })`** (и минимальный контракт
  `PartBackend` для мессенджеров/блоб-сторов): автор аддона `telegram-bot` или
  `discord` пишет всего 3 простых метода над одним куском (`putPart`,
  `openPartStream`, `deletePart`), оборачивает их в `chunkedSource(...)`, и на
  выходе получает полноценный `AdaptedStorageSource` с произвольным размером
  файлов, проверкой целостности и честным `Range`-стримингом!

---

## 1.5. Предлагаемое устройство `#lib/storage` (Этап 1)

### Структура пакета и `entrypoints.json`

Соблюдаем `tooling/public-api.mjs` и `tooling/core-purity.mjs` (узкие входы,
чтобы S3 или `node:fs` не тянулись туда, где не нужны):

```
src/lib/storage/
├── entrypoints.json       # публичные входы пакета
├── README.md              # контракт пакета, таблица возможностей и примеры
├── types.ts               # типы метаданных, ByteRange, возможностей, ошибок
├── errors.ts              # StorageError с машиночитаемыми кодами (not_found, range_invalid, quota, upstream, unsupported, invalid_key)
├── key.ts                 # нормализация и защита ключей (запрет '..', '\0', ведущих слэшей, обратных слэшей)
├── range.ts               # разбор HTTP Range, расчёт среза [start, end], обрезка ReadableStream по байтам
├── source.ts              # STORAGE_BRAND, defineStorageSource, assertAdaptedStorage, decorateStorage, composeStorages
├── chunked.ts             # контракт PartStore + адаптер/декоратор чанкованного хранения (задел под Telegram/Discord и любые лимитные облака)
├── http.ts                # serveStorageStream(request, source, key, opts) -> Response (200 / 206 / 304 / 416 + Content-Range + ETag + AbortSignal)
├── memory.ts              # встроенный источник в памяти (тесты, dev, песочницы)
├── node.ts                # источник локальной ФС (node:fs/promises + createReadStream {start,end} <-> Web ReadableStream; работает в Node >=22.17 и Bun)
├── s3.ts                  # универсальный S3-источник на aws4fetch (AWS S3, CF R2, MinIO, B2, Yandex): честный стрим GET + Range, потоковый Multipart Upload, presigned GET/PUT
├── webdav.ts              # универсальный WebDAV-источник на чистом fetch (Nextcloud, Yandex.Disk, Hetzner Storage Box): GET + Range, PUT stream, HEAD, DELETE, MKCOL, PROPFIND
└── index.ts               # реэкспорт чистого ядра (source, chunked, http, range, key, errors, memory, types)
```

*(Дополнительно по решению владельца: узкие входы `r2.js` для нативного
Cloudflare Worker `R2Bucket` binding и `vercel-blob.js` — либо сразу в Этапе 1,
либо аддонами по мере надобности; для R2 по HTTP уже сразу работает `s3.ts`.)*

### Ключевые фрагменты контракта (проект API)

```ts
/** Включительный байтовый диапазон (как в HTTP RFC 9110: bytes=start-end) или суффикс. */
export type ByteRange =
  | { readonly start: number; readonly end?: number }
  | { readonly suffixLength: number }

/** Разрешённый срез конкретного файла известного размера. */
export type ResolvedByteRange = {
  readonly start: number      // включительно, 0-based
  readonly end: number        // включительно, >= start
  readonly length: number     // end - start + 1
  readonly totalSize: number
}

/** Возможности адаптированного источника (по образцу SourceCapabilities пагинатора). */
export type StorageCapabilities = {
  /** Нативное чтение подотрезка без скачивания префикса с нуля. */
  readonly range: boolean
  /** Потоковая запись файлов крупнее одного HTTP-запроса (multipart / чанки). */
  readonly multipart: boolean
  /** Листинг ключей по префиксу (у голых квитанционных сторов без индекса — false). */
  readonly list: boolean
  /** Прямая подписанная ссылка на чтение (false у FS, Telegram, приватного WebDAV). */
  readonly presignGet: boolean
  /** Прямая подписанная ссылка на загрузку с клиента мимо сервера (обход лимита 4.5 МБ Vercel). */
  readonly presignPut: boolean
  /** Серверное копирование внутри источника без прогона байтов через приложение. */
  readonly copy: boolean
  /** Максимальный размер одиночной атомарной записи без чанкования (если ограничен). */
  readonly maxSinglePutBytes?: number
}

export type StorageObjectMeta = {
  readonly key: string
  readonly size: number
  readonly contentType?: string
  readonly etag?: string
  readonly sha256?: string
  readonly lastModifiedMs?: number
  readonly custom?: Readonly<Record<string, string>>
}

export type StorageReadResult = {
  readonly stream: ReadableStream<Uint8Array>
  readonly meta: StorageObjectMeta
  /** Заполнен, если запрошен и применён диапазон байтов (для 206 Content-Range). */
  readonly range?: ResolvedByteRange
}

export type StorageWriteInput = {
  readonly body: ReadableStream<Uint8Array> | Blob | Uint8Array
  /** Известный размер помогает S3/WebDAV/Workers идти одиночным PUT без буфера. */
  readonly size?: number
  readonly contentType?: string
  readonly sha256?: string
  readonly custom?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  /** Прогресс записи для связки с #lib/task и LoaderBar. */
  readonly onProgress?: (writtenBytes: number, totalBytes?: number) => void
}
```

### Принципиальные детали реализации базовых источников Этапа 1

1. **Честный стриминг на чтении в `s3.ts` (исправляем дефект `unstorage` и `@remix-run/file-storage-s3`):**
   - `read(key, { range, signal })` отправляет подписанный `GET` (с заголовком
     `Range: bytes=...` при запросе диапазона) и отдаёт **`response.body`
     (`ReadableStream<Uint8Array>`) напрямую**, никогда не вызывая
     `response.arrayBuffer()`.
   - На записи: если объект влезает в один `partSize` (по умолчанию `8 МиБ`,
     согласовано с `docs/pending.md`) — одиночный `PUT`; если больше или длина
     заранее неизвестна — S3 Multipart Upload (`CreateMultipartUpload` →
     конвейер `UploadPart` с удержанием в памяти не более 2 частей →
     `CompleteMultipartUpload`, при ошибке/отмене `signal` — гарантированный
     `AbortMultipartUpload`).
   - В том же модуле — `presignGet` и `presignPut` через `aws4fetch`
     (`signQuery: true`), чтобы на Vercel клиент при необходимости мог заливать
     крупные файлы прямо в S3/R2 мимо лимита 4.5 МБ.
2. **Обход утечки `Blob#stream()` в Node (`nodejs/node#63574`):**
   - Общая утилита ядра чтения входного `Blob | File` режет его кусками через
     `blob.slice(offset, offset + chunk)` вместо `blob.stream()` в Node < 24.20,
     не удерживая чанки в памяти процесса.
3. **Защита от path traversal и кривых ключей в `key.ts` (один раз в слое):**
   - Любой источник получает уже проверенный канонический ключ (без ведущих `/`,
     `..`, `.`, `\0`, `\` и управляющих символов); попытка выйти из корня `node-fs`
     или подсунуть `../` в WebDAV/S3 отсекается ядром с `StorageError('invalid_key')`.
4. **Автоматический fallback для `Range` на источниках без нативного `range`:**
   - Если у источника `capabilities.range === false`, но потребитель попросил
     небольшой диапазон, декоратор/ядро умеет либо честно отказать, либо (при
     явной опции) отрезать нужные байты потоковым трансформом и закрыть
     `reader.cancel()` сразу после `end`. А на `s3`, `node-fs`, `webdav` и
     `chunkedSource` диапазон выполняется **нативно** без прокачки лишних мегабайт.
5. **Единая HTTP-раздача `serveStorageStream` (`src/lib/storage/http.ts`):**
   - Чистая функция поверх Web `Request` / `Response` (0 зависимостей от
     SvelteKit — работает в SvelteKit `+server.ts`, Hono, Cloudflare Worker,
     Bun.serve):
     - проверяет `If-None-Match` → `304 Not Modified`;
     - разбирает `Range` → `206 Partial Content` + `Content-Range: bytes start-end/total`
       либо `416 Range Not Satisfiable`;
     - обрабатывает `HEAD` без чтения тела (`head(key)`);
     - выставляет безопасные заголовки (`Content-Type`, `X-Content-Type-Options: nosniff`,
       `Accept-Ranges: bytes`, `Content-Disposition` с RFC 5987 кодированием русских имён);
     - связывает `request.signal` с чтением потока.

---

## 1.6. Развилки и варианты (компромиссы)

### Развилка 1: Где проходит граница между Этапом 1 и Этапом 2 по чанкованию (`chunked.ts`)?
- **Вариант A (рекомендуется):** включить чистый механизм `chunked.ts`
  (`PartStore` + `defineChunkedSource` с in-memory тестом на фейковом лимитном
  сторе, например `maxPart = 64 КБ`) **уже в Этап 1**, а конкретные сетевые
  адаптеры `telegram-bot` и `discord` (с их API, троттлингом и кэшем ссылок)
  делать в **Этапе 2**.
  - *Плюс:* сразу доказываем тестами, что контракт ядра Этапа 1 реально тянет
    многочанковую запись и чтение произвольного `Range` поперёк границ кусков,
    не переделывая ядро на Этапе 2.
- **Вариант B:** в Этапе 1 сделать только ключевые источники (`memory`,
  `node-fs`, `s3`, `webdav`), а `chunked.ts` целиком перенести в Этап 2 вместе с
  Telegram/Discord.

### Развилка 2: Набор облачных адаптеров непосредственно в Этапе 1
- **Минимум Этапа 1:** `memory` + `node-fs` (Node/Bun) + `s3` (покрывает AWS S3,
  Cloudflare R2 по S3 API, MinIO, Backblaze B2, Yandex Object Storage) + `webdav`
  (Nextcloud, Yandex.Disk, Hetzner Storage Box). Итого 1 крошечная внешняя
  зависимость (`aws4fetch`).
- **Расширенный набор Этапа 1:** сразу добавить узкие входы `cloudflare-r2.ts`
  (нативный Worker binding `R2Bucket` без HTTP-подписи) и/или `vercel-blob.ts`
  (REST API Vercel Blob на чистом `fetch`, без пакета `@vercel/blob`).

### Развилка 3: Ключи и адресация между несколькими облаками (`composeStorages`)
Когда в разделе «Файлы» одновременно подключены, скажем, S3 и Telegram-бот:
- **Вариант A — префиксный локатор (`<mount>:<key>`, например `s3:2026/a.mp4`, `tg:manifest-id`):**
  ключ сам однозначно говорит `composeStorages`, в каком источнике лежат байты
  (старые файлы продолжают читаться после смены «хранилища по умолчанию для
  новых загрузок»).
- **Вариант B — источник хранится отдельным полем в таблице БД (`backend: 's3'`, `key: '2026/a.mp4'`),**
  а `composeStorages` выбирает источник по явному аргументу или префиксу.
  *(Оба подхода легко совмещаются, если `composeStorages` умеет и явный `mount`,
  и разбор `mount:key`.)*

---

## 1.7. Открытые вопросы владельцу (для утверждения Этапа 1)

1. **Подтверждаем собственное тонкое ядро `src/lib/storage` на Web Streams +
   единственную зависимость `aws4fetch` (`^1.0.20`, MIT)** (вместо тяжёлых
   `@aws-sdk/client-s3`, `flystorage`, `flydrive`, `unstorage`)?
2. **Состав адаптеров в Этапе 1:** достаточно четвёрки `memory` + `node-fs` +
   `s3` + `webdav`, или сразу включить нативный `cloudflare-r2` (binding) и
   `vercel-blob`?
3. **Механизм чанкования (`chunked.ts`):** включаем абстракцию `PartStore` +
   тесты склейки `Range` поперёк чанков сразу в ядро Этапа 1 (Вариант A), а сами
   адаптеры Telegram/Discord оставляем на Этап 2 — или уносим и `chunked.ts` в
   Этап 2?
4. **Список дальнейших этапов (Этапы 2–7 в таблице выше):** устраивает такая
   разбивка пути до готового раздела «Файлы», или хотите переставить/укрупнить
   этапы (например, какие именно неофициальные облака точно нужны в Этапе 2 —
   и Telegram, и Discord, или только один из них)?
5. *(Мелкий долг с прошлого шага)* По `coding-agent-prompt.md` в `/home/user/uploads`:
   оставляем как есть или зафиксировать там оговорённую краткую формулировку про
   сообщения только между крупными этапами?

---

## 1.8. Предварительный чек-лист реализации Этапа 1 (после отмашки владельца)

| Шаг | Содержание | Проверка |
|---|---|---|
| S0 | Подготовка песочницы к кодовым гейтам: Node.js `>= 22.17` в `/usr/local/bin`, `npm ci`, установка `aws4fetch` (при утверждении п. 1) | `node -v`, зелёный прогон базовых стражей |
| S1 | Ядро `src/lib/storage`: `types.ts`, `errors.ts`, `key.ts` (защита от path traversal), `range.ts`, `source.ts` (`defineStorageSource`, бренд, `capabilities`, `composeStorages`), `memory.ts` | Unit-тесты ядра: бренд, deny-safe возможности, `Range`-математика, запрет `..`/`\0` |
| S2 | Потоковое чанкование `chunked.ts` (если утверждён Вариант A в п. 3) + HTTP-помощник `http.ts` (`serveStorageStream`: `200`/`206`/`304`/`416`, `HEAD`, `AbortSignal`) | Unit-тесты: запись потока в чанки по N байт, чтение `Range` поперёк 3 чанков с подгрузкой только задетых кусков, проверка `SHA-256`, статусы HTTP |
| S3 | Адаптер `node.ts` (`node-fs` для Node/Bun): потоковая запись во временный файл + `rename`, чтение диапазона через `createReadStream({ start, end })`, `list`, `head`, `delete`, обход `Blob#stream()` | Интеграционные vitest-тесты на временной директории (полный цикл + конкурентная запись + обрыв `AbortSignal`) |
| S4 | Адаптер `s3.ts` (`aws4fetch`): потоковый `GET` + `Range` без `arrayBuffer()`, одиночный `PUT` и потоковый Multipart Upload (`≤ 2` частей в RAM, `AbortMultipartUpload` на сбое), `head`, `list`, `delete`, `presignGet`/`presignPut` | Unit/контрактные тесты поверх мок-сервера S3 (проверка SigV4, XML multipart, `Range`, отсутствия буферизации всего тела, отмена на обрыве) |
| S5 | Адаптер `webdav.ts` (чистый `fetch`): `GET` + `Range`, потоковый `PUT` с автосозданием папок `MKCOL` по опции, `HEAD`, `DELETE`, `PROPFIND Depth: 1` | Контрактные vitest-тесты поверх мок-WebDAV (Nextcloud/Yandex ответы `207 Multi-Status`, `Range`, ошибки `401`/`404`/`507`) |
| S6 | `entrypoints.json`, `#lib/storage/*` (уже покрыт маской `#lib/*`), `src/lib/storage/README.md`, прогон полного набора гейтов (`check`, `test:guard`, `public-api`, `core-purity`, `vitest`, `build`), локальный коммит и отчёт в этом плане | Все гейты зелёные, заполненный `<evidence_block>` |
