// Внутренняя функция профиля: совпадает ли картинка со спекой.
//
// Сервер её НЕ приводит: конвертация на сервере убрана (см.
// `docs/plan-queue.md`). Поэтому проверка — единственный вход в запись: файл,
// который уже равен спеке (формат, кадр, вес), сохраняется как есть; любой
// другой отклоняется, а не перекодируется. Приведение делает браузерный
// примитив (`photoConvert`), поэтому с JS файл приходит готовым.
// Аватарной сущности тут нет: проверка годится для любой картинки целиком.
import { probeImageHeader } from '#lib/image/probe.js'
import type { SpecAvatar } from '../../spec-avatar.js'

/** Сколько байт читаем заголовком: размеры картинки лежат в первых сотнях. */
export const SPEC_FIT_HEAD_BYTES = 262_144

/**
 * Совпадает ли файл со спекой — то есть его можно сохранять как есть.
 *
 * Тип файла здесь не проверяется: «назвался картинкой — обязан ею быть» уже
 * сделала общая проверка `image` в `#lib/form`. Остаётся то, чего она не
 * знает, — соответствие параметрам: вес не больше `maxBytes`, а реальный
 * формат и кадр из заголовка (без декодирования) равны спеке.
 *
 * @param blob Присланный клиентом файл.
 * @param spec Параметры готового кадра (`SpecAvatar`).
 * @returns `true` — файл готов; `false` — отклонять (сервер не конвертирует).
 */
export async function fitsSpec(blob: Blob, spec: SpecAvatar): Promise<boolean> {
  const mime = `image/${spec.format}`
  if (blob.size > spec.maxBytes) return false
  let head: Uint8Array
  try {
    head = new Uint8Array(await blob.slice(0, SPEC_FIT_HEAD_BYTES).arrayBuffer())
  } catch {
    return false
  }
  const facts = probeImageHeader(head)
  return facts !== null && facts.format === mime && facts.width === spec.width && facts.height === spec.height
}
