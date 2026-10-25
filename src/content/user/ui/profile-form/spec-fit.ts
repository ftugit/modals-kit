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
 * Проверяет три вещи, все дешёвые: заявленный MIME равен формату спеки, вес не
 * больше `maxBytes`, а реальные ширина и высота (по заголовку, без декодирования)
 * равны `width × height`. Содержимое с заявленным типом обязан подтвердить
 * заголовок — файл, назвавшийся JPEG, но им не являющийся, сюда не пройдёт.
 *
 * @param blob Присланный клиентом файл.
 * @param spec Параметры, к которым стремится конвертер и сервер.
 * @returns `true` — сохранять как есть; `false` — приводить.
 */
export async function fitsSpec(blob: Blob, spec: SpecAvatar): Promise<boolean> {
  const mime = `image/${spec.format}`
  if (blob.type !== mime || blob.size > spec.maxBytes) return false
  let head: Uint8Array
  try {
    head = new Uint8Array(await blob.slice(0, SPEC_FIT_HEAD_BYTES).arrayBuffer())
  } catch {
    return false
  }
  const facts = probeImageHeader(head)
  return facts !== null && facts.format === mime && facts.width === spec.width && facts.height === spec.height
}
