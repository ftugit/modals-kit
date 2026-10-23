# lib/image — обработка растровых картинок (browser-image-pipeline)

Вендоренная копия библиотеки `browser-image-pipeline` v0.7.0
(<https://github.com/1wp0i1kp2any/browser-image-pipeline>, папка `src/`,
лицензия ISC) с серверным WASM-декодером `node.ts`: декодер, операции над кадром
(`resize`, `crop`, `cover`, `sharpen`, квантование), кодеки JPEG/PNG/WebP/AVIF и
`fit` — подбор параметров под предикат приёмки приложения.

## Входы

- `index.ts` (`#lib/image/index.js`) — основной фасад: `image(input, options)`,
  пресеты (`presets.ts`), реестр кодеков (`registry.ts`). Импорт фасада не тянет
  WASM: кодеки и квантование грузятся динамически.
- `probe.ts` (`#lib/image/probe.js`) — `probeImageHeader(bytes)`: формат,
  размеры и EXIF-ориентация по заголовкам JPEG/PNG/WebP/AVIF без декодирования
  и без WASM; не бросает, `null` — не картинка. Импортируется напрямую, чтобы
  валидаторы проверяли файл по заголовку до выделения RGBA-кадра.
- `node.ts` (`#lib/image/node.js`) — серверный декодер для Node.js и SSR:
  `ensureNodeImageCodecs()` и `decodeWithNode(source)` поверх `@jsquash/{jpeg,png,webp,avif}`.

## Контракт декодера

Библиотека не знает ни лимитов веса, ни белых списков форматов: политику задаёт
приложение через предикат `fits(candidate)` и опции `fit`. Вне браузера вызов
`image(source)` **без явного `options.decoder`** намеренно отклоняется с
`EnvironmentError` (`decode.ts` остаётся строго браузерным). На сервере декодер
передаётся явно:

```ts
import { image } from '#lib/image/index.js'
import { decodeWithNode } from '#lib/image/node.js'

const bytes = await image(file, { decoder: decodeWithNode })
  .cover({ width: 256, height: 256 })
  .jpeg({ maxBytes: 32 * 1024 })
  .toBytes()
```

## Потребители в приложении

- `src/components/form/photo.ts` — тип поля `field.photo` и асинхронная
  проверка `photo:<id>` через `probeImageHeader`.
- `src/content/user/ui/profile-form/{avatar.ts,AvatarTakeover.svelte,server.ts}` —
  единый конвейер `prepareAvatar` в браузере и на сервере (`decodeWithNode`).
- `src/content/user/profile.ts` — доменная проверка заголовка и размеров аватара.
- Оставшиеся этапы конвейера — [`docs/design/image-transfer.md`](../../../docs/design/image-transfer.md).
