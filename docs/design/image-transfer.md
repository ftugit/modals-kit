# Передача и конвейер изображений в формах

Актуальный проектный документ по файловым/фото-полям приложения после запуска бинарного конвейера `ProfileForm` и серверного декодера `#lib/image/node.js`. Исторические черновики со скрытым `dataURL` в `AuthWidget` и ручным разбором `FormData` в роутах удалены.

---

## 1. Инварианты архитектуры

1. **По сети передаются только бинарные `File` в `multipart/form-data`.** Никаких скрытых полей с `base64` / `data:image/…` между браузером и сервером не существует.
2. **Единое поле описания на JS и no-JS.** Поле объявлено в `defineForm` одним именем (`avatar: field.photo(...)`). Без JS браузер отправляет исходный `File` из нативного `<input type="file">`; с JS перехватчик поля (`Field` `takeover`) готовит уменьшенный JPEG `File` через `#lib/image` и кладёт его обратно в тот же `<input type="file">` через `DataTransfer`, после чего `bind` читает штатный `FormData` с уменьшенным бинарным файлом.
3. **Сервер не перекодирует.** Его дело — проверить то же, что описано в форме: вес, медиатип и число файлов (`v.accept` / `v.maxSize` / `v.maxCount`), плюс серверный предел тела (`OI-27`). Сжатие — **опция UI-поля** , конвейер `#lib/image` работает в браузере; серверный декодер `#lib/image/node.js` остаётся для сред, которым декодировать действительно нужно (тесты, эмуляция, будущая серверная обработка), но в пути формы не участвует. Проверка содержимого по сигнатурам — открытый `OI-20`, и он расходится с решением `OI-27` («содержимое не сниффится»); до решения сервер полагается на медиатип.
4. **Не трогать браузерное умолчание в `src/lib/image/decode.ts`.** Без явного `options.decoder` вызов `image(blob)` вне браузера обязан отвергать промис с `EnvironmentError` (контракт `src/lib/image/pipeline.test.ts`). На сервере декодер передаётся явно: `{ decoder: decodeWithNode }` из `#lib/image/node.js`.
5. **Ожидание подготовки — штатный механизм поля (`FieldHandle`).** На время сжатия перехватчик взводит `f.pending = job`, при отказе — `f.error = { code }`. Кнопка отправки удерживается самой формой без ad-hoc флагов компонента.

---

## 2. Что уже реализовано в коде

| Узел | Файлы | Статус |
|---|---|---|
| Изоморфный конвейер и чтение заголовков | `src/lib/image/{index.ts,pipeline.ts,probe.ts,presets.ts}` | Готово |
| Серверный WASM-декодер для Node / SSR (`ensureNodeImageCodecs`, `decodeWithNode`) | `src/lib/image/node.ts` | Готово |
| Расширение типа поля `field.photo` и асинхронной проверки `photo:<id>` (`PhotoSpec`, `checkPhotoFile`, `registerPhotoChecks`, `photoImage`) | `src/components/form/photo.ts` | Готово |
| Перехват поля в форме (`Field` `takeover`, `FieldHandle.pending` / `FieldHandle.error`) и защита в сборке | `src/lib/form/{takeover.ts,svelte/bind.svelte.ts}`, `src/components/form/Field.svelte`, `tooling/layer-guard.mjs` | Готово |
| Компактная карточка вложения и превью (`Attachment`, `FileAttachment`) | `src/components/ui/attachment/`, `src/components/form/FileField.svelte` | Готово |
| Профиль пользователя на бинарном `File` (JS сжатие + no-JS raw `File` → серверный `decodeWithNode`) | `src/content/user/ui/profile-form/{form.ts,avatar.ts,AvatarTakeover.svelte,ProfileForm.svelte,profile.form.server.ts}` | Готово |
| Протокол отложенного исхода `outcome: 'queued'` (`QueuedData`, `assertQueuedProtocol`, `pollUntilDone`) | `src/lib/form/queued.ts` | Готово (ядро `lib/form`) |

---

## 3. Незакрытые этапы (остаток плана)

### Этап R4 — Очередь заявок в `sharedStore` и сквозной `outcome: 'queued'` для тяжёлых файлов

Когда серверная обработка файла не укладывается в интерактивный ответ или вынесена в фоновый воркер, ядро `#lib/form/queued.js` уже задаёт контракт `Result`:
- `outcome: 'queued'`;
- `data: { pollUrl, statusUrl, etaMs? }` (`assertQueuedProtocol` отвергает `queued` без обоих URL, чтобы режим без JS никогда не оказывался в тупике).

**Что остаётся сделать:**
1. В `src/hooks/component-form/server.server.ts` и `client.svelte.ts` поддержать `result.outcome === 'queued'`:
   - с JS — автоматический опрос `pollUntilDone(queuedData(result), ...)` до терминального `Result` с отображением прогресса в `formTask(bound.state)`;
   - без JS — `303 See Other` на `statusUrl` (страница статуса с `<meta http-equiv="refresh">` / кнопкой «Проверить готовность» и возвратом к исходному маршруту по завершении).
2. Хранить состояние заявки и подготовленный артефакт в `sharedStore.scope('form-jobs')` (`src/server/cache.server.ts`, таблица `public.cache_kv` в Postgres), а не в памяти процесса — чтобы опрос `pollUrl` / `statusUrl` попадал в ту же запись на любом serverless/Node-инстансе.

### Этап R5 → поля фото (решение 2026-10-24)

Вход — валидаторы (`v.accept`, `v.maxSize`, `v.maxCount`); сжатие — **опция `Field`** (`photoConvert={specAvatar}`: 200 × 200, 20 КиБ, `jpeg`; параметры — `src/content/user/spec-avatar.ts`), в описании формы её нет; при `preview` поле рисуется гибридом `FileAttachment` (`FileInput` + `Attachment`), без неё — ui-примитивом `FileInput`; голый `<input type="file">` не используется. Вид ограничения `photo-output` и `photoOutput()` **не вводятся**; сервер перекодирует только файл, пришедший без JS, — тем же конвейером `#lib/image` . Прежняя формулировка «перевести `/fields` на `field.photo`» заменена: демо переходит на файловое/фото-поле **без** перекодирования и получает загрузку **до 5 файлов** — это опция `multiple` единственного типа `file`; отдельного типа `photos` нет.

### Этап R6 — Вынос байтов аватара из запечатанной куки `auth_tmp`

Сейчас `updateProfile` сохраняет `data:image/jpeg;base64,...` в колонку `user_profile.avatar_url`, а `freshAccess` (`src/content/user/auth.ts`) запечатывает весь `prof: { nickname, avatarUrl }` прямо в `HttpOnly`-куку `auth_tmp` (`ACCESS_COOKIE`).
- На реальных фотографиях сжатый JPEG весит `8–32 КБ` (`11–44 КБ` в base64), что превышает браузерный лимит одной куки (`4096 B`, RFC 6265) и порог заголовков HTTP (`16 KiB` → `431 Request Header Fields Too Large`). Подробности и сценарий воспроизведения — [`docs/pending.md`](../pending.md).

**Что нужно сделать:**
1. В `auth_tmp` хранить только компактный признак/ревизию аватара (или короткий URL `/api/user/avatar/<id>?v=<rev>`), не сериализуя `data:image/...` в заголовок `Cookie`.
2. Выдавать бинарные байты аватара отдельным кэшируемым GET-роутом (`immutable` по ревизии) либо внешним объектным хранилищем за портом модуля `user`.

**Решение владельца (2026-10-24):** байты из куки **вырезаются**. До появления слоя хранения (`lib/storage`) витрина профиля собирается в RAM при обновлении временного токена (`issueTokens`/`freshAccess` читают `profiles.get`), `avatarUrl` в `prof` не возвращается. Замер в обоснование: кука без фото — `371 B`, фото 8 КБ — `11 315 B`, потолок конфига `20 КБ` — `27 699 B` при лимите `4096 B` (замер — [`docs/pending.md`](../pending.md)). Памятка для разработки хранилища — в шапке `src/content/user/auth.ts`.

### Этап R7 — Стражи `layer-guard` и тип `PreparedFile` на границе записи

Чтобы исключить возврат сырого разбора файлов в прикладном коде:
1. Ввести брендированный тип `PreparedPhoto` / `PreparedFile` на выходе серверного конвейера подготовки, который требуют мутации записи медиа, чтобы сырой непроверенный `File` из `FormData` нельзя было передать в хранилище по ошибке.
2. Добавить в `tooling/layer-guard.mjs` правило `isSourceCheck`, запрещающее в `src/routes/` и `src/content/` прямое чтение байтов `File` (`file.arrayBuffer()`, ручной `btoa(...)` для `data:image/`) в обход `#lib/image` и `#components/form/photo.js`.
