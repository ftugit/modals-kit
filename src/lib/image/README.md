# lib/image — обработка растровых картинок (browser-image-pipeline)

Вендоренная копия библиотеки `browser-image-pipeline` v0.7.0
(<https://github.com/1wp0i1kp2any/browser-image-pipeline>, папка `src/`,
лицензия ISC): декодер, операции над кадром (resize/crop/cover, sharpen,
квантование), кодеки JPEG/PNG/WebP/AVIF и fit — подбор параметров под предикат
приёмки приложения. Файлы лежат как в оригинале; не перенесён только
`testing.ts` (Node-фикстуры потребителя).

- `index.ts` — фасад: `image(input, build)`, пресеты, реестр кодеков. Импорт
  фасада не тянет wasm: кодеки и квантование грузятся динамически.
- `probe.ts` — `probeImageHeader(bytes)`: формат/размеры/EXIF-ориентация по
  заголовкам JPEG/PNG/WebP/AVIF без декодирования и без wasm; не бросает,
  `null` — не картинка. Импортируется напрямую (`#lib/image/probe.js`), чтобы
  серверные валидаторы не тянули ядро конвейера.

Библиотека не знает ни лимитов веса, ни белых списков форматов: политику задаёт
приложение через предикат `fits(candidate)` и опции fit. Вне браузера
декодер честно отказывает (`EnvironmentError`), если приложение не передало
свой `decoder`.

Потребители: аватар пользователя (`src/content/user/avatar.ts` — подготовка,
`src/content/user/profile.ts` — серверная проверка через probe). План
переноса — `docs/design/image-transfer.md`.
