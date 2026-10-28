# План прототипа: потоковая загрузка файлов от клиента (`wss://` → форма → минимум `#lib/storage`)

Заказ владельца (2026-10-28). Этот документ описывает **Этап-прототип**: сквозную
отправку файлов произвольного веса от клиента через форму по одному закреплённому
`wss://`-соединению с живым прогрессом в `FileAttachment` и сохранением в минимальный
срез `#lib/storage`.

Полная спецификация мультисерверного хранилища (пулы, `defineStorageLedger`,
`jsonLedger`, нарезка между серверами, потоковое шифрование `AES-256-GCM`,
`rate`/`concurrency`, `webdav`, `copy`/`move`/`clone`, `report()`) сохранена без
изменений в соседнем документе **`docs/plan-files-stages.md`** — к нему переходим
после обкатки прототипа.

---

## ПРОЦЕДУРА (для продолжения после обрыва / сжатия контекста)

1. **Пять жёстких правил (`<hard_rules>` из `coding-agent-prompt.md`):**
   1. Никаких правок без VCS: перед изменениями проверять
      `git rev-parse --is-inside-work-tree` и чистоту `git status --porcelain`
      (перед правкой > 3 файлов дерево обязано быть чистым).
   2. Локальный коммит обязателен сразу после того, как изменены файлы вне `/tmp`
      и хотя бы один гейт (тест, тайпчек, сборка) прошёл зелено. Откаты — только
      через Git (`git checkout` / `git revert`), никогда ручным обратным
      редактированием.
   3. Слова «сделано / работает / исправлено» запрещены без буквально заполненного
      `<evidence_block>` (`GIT`, `GATES`, `SKIPPED`) из реально выполненных в текущем
      ходу команд.
   4. Любое требование или правило, которое нельзя выполнить сейчас, явно называется
      вслух в ответе и фиксируется в `SKIPPED`.
   5. После любого вопроса или корректировки владельца — стоп: сначала ответить и
      дождаться решения, без правок кода пока решение не принято.
2. **VCS, секреты и защита планов при обновлении `origin/img`:**
   - Репозиторий: `/home/user/projects/modals-kit`, ветка `img`. Удалённый `origin`
     не пушим и не меняем без явной команды.
   - Секреты (`/home/user/uploads/github-token.txt` и любые учётные данные облаков)
     никогда не печатать, не логировать и не коммитить.
   - **Оба плана застрахованы в двух независимых местах:**
     1. локальная ветка-снимок `backup/plans-snapshot` внутри
        `/home/user/projects/modals-kit`;
     2. отдельный локальный Git-репозиторий `/home/user/uploads` в папке
        `/home/user/uploads/plan-backups/` (`plan-files-stages.md` и
        `plan-upload-prototype.md`).
   - **Порядок безопасного обновления `origin/img` при старте прототипа (`P0`):**
     ```bash
     git -C /home/user/projects/modals-kit branch -f backup/plans-snapshot HEAD
     git -C /home/user/projects/modals-kit fetch origin img
     git -C /home/user/projects/modals-kit rebase origin/img
     # Если в origin/img переписана история или возник конфликт — переключиться на
     # origin/img и восстановить оба файла планов из backup/plans-snapshot
     # (или /home/user/uploads/plan-backups/), сверив целостность обоих планов.
     ```
3. **Точка остановки (`STOPPED AT`):**
   - План прототипа записан, проверен и закоммичен локально; резервные копии обоих
     планов сохранены.
   - **Код в `src/` не начат.** Ждём команды владельца «начинай прототип» (после того
     как обновление прилетит в `origin/img`), первым шагом выполняем `P0`
     (подтягиваем `origin/img` без потери планов).
4. **Текущие `SKIPPED`:**
   - Подтягивание `origin/img` и запуск кодовых гейтов (`npm run check`, `vitest`,
     `vite build`, Playwright) отложены до команды владельца на старт `P0`..`P4`.

---

## 1. Цель и рамки прототипа

### 1.1. Что доказываем и закрываем прототипом

1. **Обход лимита 4.5 МБ на тело HTTP-запроса Vercel без тысячи мелких файлов:**
   клиент режет `File` в браузере (`file.slice(offset, end)`), но отправляет куски по
   **одному открытому `wss://`-соединению**, которое на Vercel (Fluid Compute),
   Cloudflare Workers и Node/Bun прибито к **одному инстансу** на всё время жизни
   сокета.
2. **Мгновенная валидация формы до перекачки файла:**
   Кадр 0 несёт текстовые поля формы + паспорта файлов (`name`, `size`, `type`,
   `lastModified`). Сервер прогоняет штатный `createFormHandler`: если текстовые поля,
   `v.accept` или `v.maxSize` невалидны — клиент мгновенно получает `422 Result` без
   отправки гигабайтов; если у поля включён `imageCheck`, сервер вытягивает только
   первые `256 КБ` заголовка и при подмене формата тоже отказывает сразу.
3. **Один файл на входе = один непрерывный поток `ReadableStream` в `#lib/storage`:**
   сервер склеивает приходящие по `wss://` бинарные кадры в единый `ReadableStream`
   с обратным давлением (`pull()` запрашивает следующий сегмент только по мере записи
   предыдущего; пик в RAM — 1 сегмент `256 КБ`) и кладёт в хранилище **ровно один
   целый файл**.
4. **Живой лог сегментов и прогресс в `FileAttachment`:**
   сервер на каждом шаге шлёт отчёт `{ fileId, sentSegments, totalSegments, receivedBytes, nextOffset, chunkBytes }`,
   транспорт обновляет `form.state.progress`, а карточки `FileAttachment` показывают
   полосу загрузки `0..100 %` без ручной обвязки на каждой странице.
5. **Ноль изменений в `src/lib/form`:**
   ядро, `svelte/` и `server.ts` библиотеки форм остаются **полностью нетронутыми**
   (`git diff src/lib/form` пуст; бюджеты `tooling/form-size.mjs` не растут ни на байт).
6. **Честная деградация без JS и для обычных форм:**
   - без JS `<form method="post" enctype="multipart/form-data">` идёт штатным HTTP
     `POST` в тот же самый `execute({ values })` в `*.form.server.ts`;
   - формы без выбранных файлов (логин, текстовые настройки, где важен HTTP
     `Set-Cookie`) автоматически уходят прежним `fetch`-транспортом.

### 1.2. Что осознанно остаётся за рамками прототипа (в `docs/plan-files-stages.md`)

- `defineStorageLedger` (`jsonLedger`, адаптер БД), квоты и предварительное
  резервирование места;
- пулы серверов (`writePool`, `splitServers`, `fallbackRead`), нарезка гигантских
  файлов между серверами и `stageToDisk`;
- потоковое шифрование `AES-256-GCM` (`key`), шейпер `rate` и семафор `concurrency`;
- драйвер `webdav` (Mail.ru Cloud и др.), `copy`/`move`/`clone`, `report()`.

При этом минимальный `#lib/storage` в прототипе сразу строится с теми же именами
входов и базовыми типами, что в `docs/plan-files-stages.md`, чтобы на следующем этапе
расширять модуль без ломки контракта формы.

---

## 2. Интеграция с текущей архитектурой (результаты аудита `lib/form`)

### 2.1. Переиспользуемые узлы проекта (`<reuse_ladder>`)

| Узел в репозитории | Как переиспользуем в прототипе |
|---|---|
| `#lib/form` (`Transport`, `TransportRequest.report`, `signal`) | Клиентский `wss://`-транспорт подключается штатным `Transport`; прогресс летит через уже существующий `req.report(progress)` → `form.state.progress`; отмена/размонтирование закрывает сокет по `req.signal`. |
| `#lib/form/server.js` (`createFormHandler`, `order`) | Передаём `order: [methodLayer(), originGuard, bodyLayer, wsFilesLayer, namesLayer]`. `bodyLayer` разбирает лёгкие текстовые поля Кадра 0, а `wsFilesLayer` кладёт в `ctx.form` потоковые `StreamFile`. |
| `src/components/form/image.ts` (`imageCheck`) | Вызывает `file.slice(0, 256 * 1024).arrayBuffer()`. Наш `StreamFile` подтягивает по сокету только первый сегмент (`256 КБ`), кэширует его в памяти на время запроса и при старте `execute()` отдаёт в начало потока без повторной пересылки. |
| `src/components/ui/file-attachment/FileAttachment.svelte` | Уже принимает `itemProps?: (file, index) => FileAttachmentItemMeta` (`state: 'uploading' \| 'processing' \| 'done' \| 'error'`, `progress: 0..100`). Остаётся прокинуть проекцию в `Field.svelte` / `FileField.svelte`. |
| `@vercel/functions@3.10.1` + `ws@8.22.0` + `src/server/after-response.server.ts` | Уже установлены в проекте. По образцу `after-response.server.ts` пишем единый платформенный мост `upgradeWs` (Vercel `upgradeWebSocket` / Cloudflare `WebSocketPair` / Node & Vite dev `ws`). |

### 2.2. Четыре учтённые ловушки (почему решение не требует правок `lib/form`)

1. **`bodyLayer` обязателен в `createFormHandler`:** решаем двухшагово — `Request` с
   лёгкими текстовыми полями проходит `bodyLayer` за < 1 мс, а следующий слой
   `wsFilesLayer` добавляет потоковые файлы в `ctx.form` до `namesLayer` и `evaluate`.
2. **`LazyFile` из `@remix-run/lazy-file` не является `instanceof File`:** пишем
   обёртку `StreamFile extends File` (`super([], name, { type, lastModified })` —
   `0` байт в памяти), делегирующую `.size`, `.stream()`, `.slice()`, `.bytes()`,
   `.arrayBuffer()` в `LazyContent`. Проходит `FormData.append`, `instanceof File`,
   `instanceof Blob` (`stripSecret`) и `imageCheck`.
3. **`DEFAULT_LIMITS.timeoutMs = 15_000` в `server.ts`:** для `wss://`-приёмника
   передаём расширенный `timeoutMs` (например `300_000` мс под лимит инстанса), чтобы
   длительная загрузка не обрывалась на 15-й секунде.
4. **`FORM_BODY_LIMIT` (`4.5 МБ`) в `form.budget`:** для `wss://`-приёмника потолок
   `limits.maxBytes` ставится по потолку сокет-загрузки, а не по лимиту одиночного
   HTTP-тела Vercel; размер каждого файла проверяет `v.maxSize(...)` в описании формы.

### 2.3. Отвергнутые альтернативы

- **Нарезка на сотни отдельных HTTP `POST` с сохранением каждого сегмента отдельным
  файлом в R2/WebDAV:** отвергнуто владельцем — риск бана/рейтлимита на WebDAV и
  расход лимитов операций / мусорные части в R2.
- **Правка `src/lib/form/server.ts` и `svelte/bind.svelte.ts`:** отвергнуто — все
  точки расширения (`Transport.report`, `order` слоёв, `File` в `FormData`) уже есть;
  правка ядра зря раздула бы `tooling/form-size.mjs`.

---

## 3. Протокол `wss://`-сессии и структура модулей

### 3.1. Обмен кадрами по одному сокету (`/api/form-upload` или внутренний маршрут кита)

1. **`Upgrade` (`GET` → `101 Switching Protocols`):**
   проверяется `originGuard` (`src/server/form-security.server.ts`); сохраняются
   заголовки рукопожатия (`Origin`, `Cookie`, `User-Agent`) и `RequestEvent`
   (`locals`, `getClientAddress`).
2. **Кадр 0 (клиент → сервер, текст JSON):**
   ```json
   {
     "type": "init",
     "target": "/upload-demo",
     "envelope": { "formId": "...", "revision": 1, "instance": "...", "submissionId": "...", "intent": "submit" },
     "fields": [["__form_id", "..."], ["title", "Мой файл"]],
     "files": [
       { "id": "f0", "field": "attachment", "name": "video.mp4", "size": 25165824, "type": "video/mp4", "lastModified": 1760000000000 }
     ]
   }
   ```
3. **Запрос сегмента с логом (сервер → клиент, текст JSON — строго по `pull()` потока):**
   ```json
   {
     "type": "pull",
     "fileId": "f0",
     "segmentIndex": 3,
     "totalSegments": 96,
     "sentSegments": 3,
     "receivedBytes": 786432,
     "offset": 786432,
     "length": 262144
   }
   ```
   Размер сегмента по умолчанию: **`262_144` байта (`256 КБ`)** — укладывается в
   дефолтный `maxPayload` `upgradeWebSocket` на Vercel (`256 KiB`) и кратен блоку
   `64 КБ` будущего шифрования из `docs/plan-files-stages.md`.
4. **Бинарный кадр сегмента (клиент → сервер, `ArrayBuffer` / `Uint8Array`):**
   клиент режет `file.slice(offset, offset + length)` и отправляет бинарным фреймом,
   одновременно обновляя `req.report(...)` для плавного прогресса в `Attachment`.
5. **Финал (сервер → клиент, текст JSON):**
   когда `storage.put` дописал поток в один файл и `execute()` вызвал `commit()`,
   сервер отправляет `{ "type": "result", "status": 200, "result": { ...Result } }`
   (или `{ "type": "result", "status": 422, "result": { ... } }` на любом этапе отказа)
   и штатно закрывает сокет (`1000`). При обрыве связи поток прерывается, а временный
   `*.part` файл удаляется.

### 3.2. Затрагиваемые и создаваемые файлы

- **Минимальный `#lib/storage` (автономный слой `src/lib/storage`, 0 импортов из `#lib/*` и SvelteKit):**
  - `src/lib/storage/entrypoints.json` (`./index.js`, `./local.js`)
  - `src/lib/storage/stream-file.ts` (`StreamFile extends File` поверх `LazyContent`)
  - `src/lib/storage/types.ts` (базовые типы `Storage`, `StorageDriver`, `PutInput`, `StoredObject`, совместимые с `docs/plan-files-stages.md`)
  - `src/lib/storage/memory.ts` (`memoryDriver` для быстрых юнит-тестов)
  - `src/lib/storage/index.ts` (`createStorage`, `StreamFile`, `memoryDriver`, `serve` через `@remix-run/response`)
  - `src/lib/storage/local.ts` (`localDriver`: потоковая запись в `*.part` → атомарный `rename`, чтение через `@remix-run/fs` / `LazyFile`, автоочистка `*.part` при обрыве потока)
  - `src/lib/storage/storage.test.ts`
- **Серверный `wss://`-мост и сессия приёма форм:**
  - `src/server/ws-upgrade.server.ts` (универсальный `upgradeWs`: Vercel `upgradeWebSocket` / Cloudflare `WebSocketPair` / Node `ws` через глобальный реестр апгрейдов)
  - `src/server/vite-ws.ts` + подключение в `vite.config.ts` (`configureServer` + `configurePreviewServer` для `vite dev` и `vite preview`)
  - `src/hooks/component-form/ws-session.server.ts` (протокол Кадра 0 → `wsFilesLayer` → `StreamFile` с кэшем головы `256 КБ` → `pull` с логом сегментов → `Result`)
  - `src/routes/api/form-upload/+server.ts` (точка `GET` апгрейда для Vercel/Cloudflare и единый путь `/api/form-upload`)
- **Клиентский транспорт и прогресс в `FileAttachment`:**
  - `src/hooks/component-form/ws-transport.ts` (клиентский `Transport` по `wss://` с автофолбэком на обычный HTTP-транспорт, когда в `FormData` нет непустых `File`)
  - `src/hooks/component-form/upload-progress.ts` + реактивный контекст прогресса формы в `bindComponentForm` / `Form`
  - `src/components/form/Field.svelte` и `src/components/form/FileField.svelte` (автоматическая передача `itemProps` с `{ state, progress }` в `FileAttachment`)
- **Демо-маршрут и проверки прототипа:**
  - компактная демо-форма загрузки файлов (с проверками `required`, `v.accept`, `v.maxSize`, `imageCheck`, сохранением полей Кадра 0 + URL файла в `#lib/storage` и раздачей загруженного файла с `Range`) + Playwright-проверка.

---

## 4. Пошаговый чеклист реализации и верификации (`P0` → `P4`)

Каждый шаг завершается своим набором проверок и отдельным локальным Git-коммитом
(`<local_git_checkpoints>`).

- [ ] **`P0` — Синхронизация `origin/img`, окружение и зависимости**
  - Обновить `backup/plans-snapshot`, выполнить `git fetch origin img` и аккуратно
    поднять ветку поверх свежего `origin/img`, убедившись, что оба файла
    `docs/plan-files-stages.md` и `docs/plan-upload-prototype.md` на месте.
  - Проверить/поднять Node.js `>= 22.17` в PATH песочницы, установить
    `@remix-run/lazy-file`, `@remix-run/response`, `@remix-run/fs` (и при
    необходимости явный `ws` / `@types/ws`, сверив с `package-lock.json`).
  - Гейт: `node tooling/public-api.mjs`, `npm run check`.

- [ ] **`P1` — Минимальный `#lib/storage` (`index.ts`, `local.ts`, `StreamFile`)**
  - Реализовать `StreamFile extends File`, `memoryDriver`, `localDriver` (потоковая
    запись через `*.part` → `rename`, очистка при ошибке/обрыве потока, `serve` с
    `206 Partial Content` и `HEAD`), объявить входы в `src/lib/storage/entrypoints.json`.
  - Критерий приёмки: `0` импортов из `#lib/*` и SvelteKit; поток в несколько мегабайт
    пишется на диск одним файлом без буферизации целиком и отдаётся с `Range`.
  - Гейт: `npx vitest run src/lib/storage`, `node tooling/public-api.mjs`,
    `node --test tooling/public-api.test.mjs`, локальный коммит.

- [ ] **`P2` — Серверный `wss://`-мост и потоковый приёмник форм**
  - Реализовать `ws-upgrade.server.ts`, Vite-плагин апгрейда для `dev`/`preview`,
    маршрут `/api/form-upload` и `ws-session.server.ts` поверх штатного
    `createFormHandler` (`wsFilesLayer`, `StreamFile` с кэшем первых `256 КБ`).
  - Критерий приёмки (интеграционный тест реальным `ws`-клиентом):
    1. невалидные текстовые поля или `v.maxSize` на Кадре 0 → мгновенный `422` (`0`
       вытянутых сегментов);
    2. битая картинка при `imageCheck` → вытянут только 1-й сегмент (`256 КБ`), сразу
       `422`, временных файлов на диске `0`;
    3. валидный файл `> 5 МБ` (больше лимита Vercel 4.5 МБ) → серия `pull`-сообщений
       с логами сегментов → ровно `1` итоговый файл в `localDriver` + сохранённые
       данные формы из Кадра 0;
    4. обрыв сокета посреди потока → `*.part` удалён, запись формы не сохранена;
    5. `git diff src/lib/form` пуст.
  - Гейт: `npx vitest run` по новым модулям + `npm run check` + `node tooling/public-api.mjs`, локальный коммит.

- [ ] **`P3` — Клиентский `wss://`-транспорт и живой лоадер в `FileAttachment`**
  - Реализовать `ws-transport.ts`, подключить автовыбор транспорта в
    `bindComponentForm` и проброс прогресса в `Field.svelte` → `FileField.svelte` →
    `FileAttachment` (`itemProps`).
  - Критерий приёмки: карточки выбранных файлов получают `state: 'uploading'` и
    растущий `progress` `0..100`, формы без файлов идут обычным `fetch`,
    `src/lib/form` не изменён.
  - Гейт: компонентные/юнит-тесты Vitest + `npm run check` + `node tooling/classes-audit.mjs`, локальный коммит.

- [ ] **`P4` — Демо-сценарий, Playwright-проверка в браузере и финальный гейт**
  - Собрать живую страницу/форму проверки прототипа (с загрузкой файла `> 5 МБ` по
    `wss://`, видимым прогрессом в `FileAttachment`, сохранением текстовых полей +
    ссылки на файл, скачиванием/`Range` и проверкой нативного `POST` без JS).
  - Прогнать реальный сценарий в headless Chromium (Playwright): проверить кадры
    WebSocket, прогресс-бар в DOM, итоговый сохранённый файл и путь с отключённым JS.
  - Финальный полный прогон перед завершением этапа (`npm run check`, `vitest run`,
    стражи `tooling/`, `npm run build`, браузерный тест) и локальный коммит.
