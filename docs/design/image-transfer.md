# Передача и конвейер изображений в формах

Актуальный проектный документ по файловым/фото-полям приложения после запуска бинарного конвейера `ProfileForm` и серверного декодера `#lib/image/node.js`. Исторические черновики со скрытым `dataURL` в `AuthWidget` и ручным разбором `FormData` в роутах удалены.

---

## 1. Инварианты архитектуры

1. **По сети передаются только бинарные `File` в `multipart/form-data`.** Никаких скрытых полей с `base64` / `data:image/…` между браузером и сервером не существует.
2. **Единое поле описания на JS и no-JS.** Поле объявлено в `defineForm` одним именем (`avatar: field.photo(...)`). Без JS браузер отправляет исходный `File` из нативного `<input type="file">`; с JS перехватчик поля (`Field` `takeover`) готовит уменьшенный JPEG `File` через `#lib/image` и кладёт его обратно в тот же `<input type="file">` через `DataTransfer`, после чего `bind` читает штатный `FormData` с уменьшенным бинарным файлом.
3. **Сервер никому не верит на слово и повторяет конвейер тем же `#lib/image`.** Серверный обработчик принимает `File`, проверяет заголовок (`probeImageHeader` без декодирования — защита от не-картинок и декомпрессионных бомб до выделения кадра RGBA) и прогоняет тот же `prepareAvatar(..., { decoder: decodeWithNode })` через WASM-кодеки `@jsquash/*` в Node (`src/lib/image/node.ts`).
4. **Не трогать браузерное умолчание в `src/lib/image/decode.ts`.** Без явного `options.decoder` вызов `image(blob)` вне браузера обязан отвергать промис с `EnvironmentError` (контракт `src/lib/image/pipeline.test.ts`). На сервере декодер передаётся явно: `{ decoder: decodeWithNode }` из `#lib/image/node.js`.
5. **Ожидание подготовки — штатный механизм поля (`FieldHandle`).** На время сжатия перехватчик взводит `f.pending = job`, при отказе — `f.error = { code }`. Кнопка отправки удерживается самой формой без ad-hoc флагов компонента.

---

## 2. Что уже реализовано в коде

| Узел | Файлы | Статус |
|---|---|---|
| Изоморфный конвейер и чтение заголовков | `src/lib/image/{index.ts,pipeline.ts,probe.ts,presets.ts}` | Готово |
| Серверный WASM-декодер для Node / SSR (`ensureNodeImageCodecs`, `decodeWithNode`) | `src/lib/image/node.ts`, `src/lib/image/test-wasm.ts` | Готово |
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

### Этап R5 — Миграция демо `/fields` на общий фото-контур

В `src/routes/(site)/(app)/fields/{forms.ts,fields.form.server.ts}` остаётся дореформенная обработка изображения:
- локальная функция `sniff(b: Uint8Array)` проверяет только магические байты PNG/JPEG/WebP/GIF, не проверяя ни геометрию кадра, ни потолок пикселей (`maxPixels` / `maxSide` против декомпрессионных бомб);
- локальная функция `base64(b: Uint8Array)` вручную сериализует сырой буфер в `data:image/...;base64,...` без перекодирования;
- поле объявлено как `field.file({ variant: 'preview' })` вместо `field.photo(...)` с `PhotoSpec` из `#components/form/photo.js`.

**Что нужно сделать:**
1. Описать спецификацию `FIELDS_IMAGE_SPEC: PhotoSpec` и подключить `registerPhotoChecks` + `photoImage('fields-image')` в `src/routes/(site)/(app)/fields/forms.ts` и `handle.ts`.
2. Удалить рукописные `sniff()` и `base64()` из `src/routes/(site)/(app)/fields/fields.form.server.ts`, переведя серверную подготовку на `#lib/image` (`probeImageHeader` + `decodeWithNode` при нормализации).

### Этап R6 — Вынос байтов аватара из запечатанной куки `auth_tmp`

Сейчас `updateProfile` сохраняет `data:image/jpeg;base64,...` в колонку `user_profile.avatar_url`, а `freshAccess` (`src/content/user/auth.ts`) запечатывает весь `prof: { nickname, avatarUrl }` прямо в `HttpOnly`-куку `auth_tmp` (`ACCESS_COOKIE`).
- На реальных фотографиях сжатый JPEG весит `8–32 КБ` (`11–44 КБ` в base64), что превышает браузерный лимит одной куки (`4096 B`, RFC 6265) и порог заголовков HTTP (`16 KiB` → `431 Request Header Fields Too Large`). Подробности и сценарий воспроизведения зафиксированы в [`docs/audit/testing-backlog.md`](../audit/testing-backlog.md) (`TB-01`).

**Что нужно сделать:**
1. В `auth_tmp` хранить только компактный признак/ревизию аватара (или короткий URL `/api/user/avatar/<id>?v=<rev>`), не сериализуя `data:image/...` в заголовок `Cookie`.
2. Выдавать бинарные байты аватара отдельным кэшируемым GET-роутом (`immutable` по ревизии) либо внешним объектным хранилищем за портом модуля `user`.

### Этап R7 — Стражи `layer-guard` и тип `PreparedFile` на границе записи

Чтобы исключить возврат сырого разбора файлов в прикладном коде:
1. Ввести брендированный тип `PreparedPhoto` / `PreparedFile` на выходе серверного конвейера подготовки, который требуют мутации записи медиа, чтобы сырой непроверенный `File` из `FormData` нельзя было передать в хранилище по ошибке.
2. Добавить в `tooling/layer-guard.mjs` правило `isSourceCheck`, запрещающее в `src/routes/` и `src/content/` прямое чтение байтов `File` (`file.arrayBuffer()`, ручной `btoa(...)` для `data:image/`) в обход `#lib/image` и `#components/form/photo.js`.
