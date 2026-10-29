# Передача и конвейер изображений в формах

Актуальный проектный документ по файловым/фото-полям приложения, бинарному конвейеру `ProfileForm`, хранению аватаров по неизменяемым ссылкам и серверному декодеру `#lib/image/node.js`.

---

## 1. Инварианты архитектуры

1. **По сети, в БД и в куках никогда не ходят `base64`-файлы.** По сети передаются только бинарные `File` в `multipart/form-data` или по потоковому `wss://` (`/api/form-upload`). В колонке `user_profile.avatar_url` и в сессионном снимке хранится только короткая неизменяемая ссылка `/api/storage/avatars/…`. Прямое чтение файлов целиком в `base64` (`arrayBuffer` / `FileReader` + `btoa`) блокируется стражем `tooling/layer-guard.mjs`.
2. **Единое поле описания на JS и no-JS.** Поле объявлено в `defineForm` одним именем (`avatar: field.photo(...)`). Без JS браузер отправляет исходный `File` из нативного `<input type="file">`; с JS примитив с `photoConvert={specAvatar}` готовит уменьшенный JPEG `200×200` (`<= 20 КиБ`) через `#lib/image` и кладёт его обратно в `<input type="file">` через `DataTransfer`, после чего форма отправляет уменьшенный бинарный файл.
3. **Сервер проверяет каноническую спецификацию и кладёт файл в боевое хранилище.** `profile.form.server.ts` проверяет готовый кадр по `fitsSpec` (`200×200` JPEG `<= 20 КиБ`), сохраняет его в боевой пул `appStorage` (`src/server/app-storage.server.ts`) по неизменяемому пути с версией, а при замене аватара или удалении профиля немедленно удаляет прежний файл через `storage.remove`.
4. **Не трогать браузерное умолчание в `src/lib/image/decode.ts`.** Без явного `options.decoder` вызов `image(blob)` вне браузера обязан отвергать промис с `EnvironmentError` (контракт `src/lib/image/pipeline.test.ts`). На сервере декодер передаётся явно: `{ decoder: decodeWithNode }` из `#lib/image/node.js`.
5. **Ожидание подготовки — штатный механизм поля (`FieldHandle`).** На время сжатия взводится `f.pending = job`, при отказе — `f.error = { code }`. Кнопка отправки удерживается самой формой без ручных флагов компонента.

---

## 2. Что реализовано в коде

| Узел | Файлы | Статус |
|---|---|---|
| Изоморфный конвейер и чтение заголовков | `src/lib/image/{index.ts,pipeline.ts,probe.ts,presets.ts}` | Готово |
| Серверный WASM-декодер для Node / SSR (`ensureNodeImageCodecs`, `decodeWithNode`) | `src/lib/image/node.ts` | Готово |
| Расширение типа поля `field.photo` и асинхронной проверки `photo:<id>` (`PhotoSpec`, `checkPhotoFile`, `registerPhotoChecks`) | `src/components/form/photo.ts` | Готово |
| Перехват поля в форме (`Field` `takeover`, `FieldHandle.pending` / `FieldHandle.error`) и защита в сборке | `src/lib/form/{takeover.ts,svelte/bind.svelte.ts}`, `src/components/form/Field.svelte`, `tooling/layer-guard.mjs` | Готово |
| Компактная карточка вложения и превью (`Attachment`, `FileAttachment`) | `src/components/ui/attachment/`, `src/components/form/FileField.svelte` | Готово |
| Боевой пул хранилища в БД + неизменяемые ссылки аватаров `/api/storage/avatars/…` с удалением старого файла | `src/server/app-storage.server.ts`, `src/content/storage-servers/`, `src/content/user/ui/profile-form/profile.form.server.ts` | Готово |
| Протокол отложенного исхода `outcome: 'queued'` (`pollUntilDone` с JS, `303` на `statusUrl` без JS и очередь в `sharedStore` `cache_kv`) | `src/lib/form/queued.ts`, `src/hooks/component-form/server.server.ts`, `src/routes/(site)/(app)/form/queue.server.ts` | Готово |

---

## 3. Отложенный этап

### Серверная фоновая перекодировка несжатых исходников аватаров без JS

При отключённом JavaScript браузер не запускает клиентский кроп/ресайз `photoConvert={specAvatar}`, поэтому несжатая фотография отклоняется проверкой `fitsSpec`. Вынос серверного ресайза через `#lib/image/node.js` и очередь фоновых задач отложен отдельным этапом (`docs/pending.md`).
