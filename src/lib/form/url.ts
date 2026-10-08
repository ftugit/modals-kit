// URL-контур формы (этап 4, §6.4): адрес ⇄ значения.
//
// Кодек НЕ знает о носителе: чтение и запись адреса — дело хоста (url-адаптер
// пагинатора, sink). Здесь только два чистых преобразования ПО ТЕМУ ЖЕ типу
// контракту полей (decode/encode реестра), поэтому значения из GET совпадают
// со значениями POST-конверта байт в байт — один код-путь на оба транспорта.
import { decode, type Decoded } from './decode'
import type { FormDescription } from './describe'

/**
 * Адрес (строка запроса) → значения + структурные ошибки разбора.
 * `URLSearchParams` совместим с `EntrySource` — разбор общий с POST.
 */
export function readUrlForm(search: string | URLSearchParams, d: FormDescription): Decoded {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  return decode(params, d)
}

/**
 * Значения → query string.
 * - дефолт и пустое НЕ пишутся: отсутствие ключа и есть дефолт (чистота адреса);
 * - чужие ключи `base` сохраняются как были — параметры страницы форме не принадлежат;
 * - несколько значений — повторяющиеся ключи (нативная семантика GET-форм;
 *   канонический CSV собирает потребитель через lib/links, не кодек);
 * - file-поля в GET невозможны — пропускаются (как браузер при нативной отправке).
 */
export function writeUrlForm(
  values: Record<string, unknown>,
  d: FormDescription,
  base: string | URLSearchParams = '',
): string {
  const params = new URLSearchParams(base)
  const emit: Array<[string, string]> = []
  /** Все ключи, которые форма МОГЛА оставить в адресе (значение + дефолт) — подчистить. */
  const possible = new Set<string>()
  for (const f of d.fields) {
    possible.add(f.name)
    const type = d.registry.types.get(f.kind)
    for (const src of [values[f.name], f.defaultValue]) {
      if (src === undefined) continue
      const out: Array<[string, string | File]> = []
      type.encode(src as never, f.name, out)
      for (const [k] of out) possible.add(k)
    }
    const v = values[f.name]
    if (v === undefined || v === null || v === '' || v === f.defaultValue || v === type.empty) continue
    if (Array.isArray(v) && v.length === 0) continue
    const out: Array<[string, string | File]> = []
    type.encode(v as never, f.name, out)
    for (const [k, val] of out) if (typeof val === 'string') emit.push([k, val])
  }
  for (const k of possible) params.delete(k)
  for (const [k, val] of emit) params.append(k, val)
  return params.toString()
}
