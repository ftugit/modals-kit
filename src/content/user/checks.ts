// Асинхронные проверки формы пользователя: один реестр, построенный от
// снимка конфига, — для браузера (`bind`) и для сервера (обработчик).
//
// Здесь нет ни одного правила о конкретном поле: содержимое изображений судит
// общая проверка `image` (`#components/form/image.js`, регистрируется в
// `extend.ts`), запрещённые ники — правило этого модуля.
import { CheckRegistry, issue } from '#lib/form/index.js'
import { registerImageCheck } from '#components/form/image.js'
import type { ConfigValues } from './config.js'

/** Часть конфига, от которой зависят проверки формы пользователя. */
export type UserChecksSnapshot = Pick<ConfigValues, 'nicknameForbidden'>

/**
 * Реестр проверок формы пользователя от снимка конфига: содержимое изображений
 * (`image` — общее правило приложения) и запрещённые никнеймы
 * (`nickname-forbidden`, код отказа — доменный `profile.nickname-forbidden`).
 * Сравнение никнейма повторяет домен: обрезка пробелов, регистр не важен.
 */
export function createUserChecks(snapshot: UserChecksSnapshot): CheckRegistry {
  const checks = new CheckRegistry()
  registerImageCheck(checks)
  const forbidden = new Set(snapshot.nicknameForbidden.map((n) => n.trim().toLowerCase()))
  checks.register('nickname-forbidden', async (value) => {
    const key = String(value ?? '').trim().toLowerCase()
    return key && forbidden.has(key) ? issue('profile.nickname-forbidden', { nickname: value }) : null
  })
  return checks
}
