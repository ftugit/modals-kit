// Разбор записей в значения. Один код-путь: его зовут и браузер, и сервер
// над одним и тем же FormData.
import type { FormDescription } from './describe'
import { safeObject, type FieldPath } from './types'

/** Минимальный контракт источника: и FormData, и тестовый объект. */
export interface EntrySource {
  getAll(name: string): (string | File)[] | FormDataEntryValue[]
  keys(): IterableIterator<string> | Iterable<string>
}

export interface Structural { path: FieldPath; code: string; params?: Record<string, unknown> }

export interface Decoded {
  values: Record<string, unknown>
  /** Значение не разбирается в тип: переносится даже на непосещённое поле. */
  structural: Structural[]
}

export function decode(form: EntrySource, d: FormDescription): Decoded {
  const values = safeObject<unknown>()
  const structural: Structural[] = []
  for (const f of d.fields) {
    const type = d.registry.types.get(f.kind)
    const r = type.decode(form.getAll(f.name) as (string | File)[], { path: f.name, input: f.input })
    if (r.ok) values[f.name] = r.value
    else { values[f.name] = type.empty; structural.push({ path: f.name, code: r.code, params: r.params }) }
  }
  return { values, structural }
}

export function encode(values: Record<string, unknown>, d: FormDescription): FormData {
  const out = new FormData()
  for (const f of d.fields) {
    const v = values[f.name]
    if (v === undefined) continue
    const pairs: Array<[string, string | File]> = []
    d.registry.types.get(f.kind).encode(v, f.name, pairs)
    for (const [k, val] of pairs) out.append(k, val as string)
  }
  return out
}

/** Значения без secret-полей: пароль не возвращается наружу. */
export function stripSecret(values: Record<string, unknown>, d: FormDescription) {
  const out = safeObject<unknown>()
  for (const f of d.fields) if (!f.secret && f.name in values) out[f.name] = values[f.name]
  return out
}
