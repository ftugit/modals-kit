// Асинхронные проверки формы пользователя: один реестр, построенный от
// снимка конфига, — для браузера (`bind`) и для сервера (обработчик).
// Описание формы (`forms.ts`) статично и снимка не знает: оно ссылается на
// проверки по именам, а списки и лимиты живут здесь, в замыканиях функций.
// Клиент получит снимок из `load`, сервер — из `UserConfig`; функции
// проверки по обе стороны буквально одни и те же.
import { CheckRegistry, issue } from '#lib/form/index.js'
import { registerPhotoChecks, type PhotoSpec } from '#components/form/photo.js'
import type { ConfigValues } from './config.js'

/** id фото-спецификации аватара (имя проверки — `photo:avatar`). */
export const AVATAR_PHOTO_ID = 'avatar'

/** Предел веса СЫРОГО фото на сервере, байт (до конвертации). */
export const PHOTO_RAW_MAX_BYTES = 8 * 1024 * 1024

/**
 * Потолки по заголовку файла. Предварительные числа: серверный декодер
 * уточнит их замерами этапа R3 (память воркера — главный ограничитель).
 */
export const PHOTO_MAX_PIXELS = 12_000_000
export const PHOTO_MAX_SIDE = 8192

/** Форматы сырья, которые сервер конвертирует сам (путь без JS и сырой POST). */
export const SERVER_PHOTO_FORMATS = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Спецификация аватара от конфига: вход — серверное сырьё, выход — готовый
 * JPEG (`avatarEdge`/`avatarMaxBytes`). Прежний `avatarFormats` смешивал обе
 * роли и описывал base64-транспорт; с файловым контуром роли разведены здесь.
 */
export function avatarPhotoSpec(
  values: Pick<ConfigValues, 'avatarEdge' | 'avatarMaxBytes'>,
): PhotoSpec {
  return {
    id: AVATAR_PHOTO_ID,
    input: {
      formats: SERVER_PHOTO_FORMATS,
      maxBytes: PHOTO_RAW_MAX_BYTES,
      maxPixels: PHOTO_MAX_PIXELS,
      maxSide: PHOTO_MAX_SIDE,
    },
    output: { format: 'image/jpeg', edge: values.avatarEdge, maxBytes: values.avatarMaxBytes },
  }
}

/** Часть конфига, от которой зависят проверки формы пользователя. */
export type UserChecksSnapshot = Pick<
  ConfigValues,
  'nicknameForbidden' | 'avatarEdge' | 'avatarMaxBytes'
>

/**
 * Реестр проверок формы пользователя от снимка конфига: запрещённые
 * никнеймы (`nickname-forbidden`, код отказа — доменный
 * `profile.nickname-forbidden`) и содержимое аватара (`photo:avatar`).
 * Сравнение никнейма повторяет домен: обрезка пробелов, регистр не важен.
 */
export function createUserChecks(snapshot: UserChecksSnapshot): CheckRegistry {
  const checks = new CheckRegistry()
  const forbidden = new Set(snapshot.nicknameForbidden.map((name) => name.toLowerCase()))
  checks.register('nickname-forbidden', async (value) => {
    const nickname = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return nickname !== '' && forbidden.has(nickname)
      ? issue('profile.nickname-forbidden')
      : null
  })
  registerPhotoChecks(checks, [avatarPhotoSpec(snapshot)])
  return checks
}
