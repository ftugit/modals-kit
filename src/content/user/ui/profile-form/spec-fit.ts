// Внутренняя функция роутов профиля: годится ли картинка без конвертации.
//
// Это «если» перед приведением: файл от клиента, который УЖЕ совпал со спекой
// (формат, вес, кадр), сохраняется как есть — без повторного кодирования и
// потери качества. Не совпал — роут приводит его параметрами той же спеки.
// Аватарной сущности тут нет: проверка годится для любой картинки целиком.
import { probeImageHeader } from '#lib/image/probe.js'
import type { SpecAvatar } from '../../spec-avatar.js'

/** Сколько байт читаем заголовком: размеры картинки лежат в первых сотнях. */
export const SPEC_FIT_HEAD_BYTES = 262_144

/**
 * Совпадает ли файл со спекой — то есть конвертация не нужна.
 *
 * Тип файла здесь не проверяется: «назвался картинкой — обязан ею быть» уже
 * сделала общая проверка `image` в `#lib/form` до вызова роута. Остаётся то,
 * чего она не знает, — соответствие параметрам: вес не больше `maxBytes`, а
 * реальный формат и кадр из заголовка (без декодирования) равны спеке.
 *
 * @param blob Присланный клиентом файл.
 * @param spec Параметры, к которым стремится конвертер и сервер.
 * @returns `true` — сохранять как есть; `false` — приводить.
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
