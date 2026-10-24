// Контракт «действие ⇄ результат»: общий язык браузера, сервера и показа.
import { defaultPolicy, type LimitPolicy } from './policy'
import type { FieldPath, FormId, InstanceId, Revision, SubmissionId } from './types'

/** Четыре значения, и ни одного «наверное». */
export type Outcome = 'not-applied' | 'committed' | 'unknown' | 'queued'

/** Ошибка в языке показа: `path`, `code`, текст и происхождение (`client`, `server`). */
export interface FormError {
  readonly id: string            // стабильный: `${path|'*'}:${code}:${hash(params)}`
  readonly code: string
  /** Текст. Пустой — ошибка есть, но показывать нечего. */
  readonly message?: string
  /**
   * Свой текст этой ошибки — шаблон от валидатора (`.message()`, F56). При
   * нормализации сильнее словарей; подстановки — из `params`.
   */
  readonly template?: string
  readonly params?: Record<string, unknown>
  /** Есть путь — ошибка поля. Нет — общая. Других правил нет. */
  readonly path?: FieldPath
  readonly origin: 'core' | 'server' | 'external'
  /** Исходные данные чужой службы: чтобы манипулировать, не разбирая тело заново. */
  readonly source?: unknown
  /** Эта ошибка не даёт подсветки, даже если настройка велит считать по факту. */
  readonly silent?: boolean
  readonly retryable?: boolean
}

/** Итог отправки: общий язык браузера, сервера и показа. */
export interface Result<TData = unknown> {
  /** Версия контракта. */
  readonly v: 1
  readonly formId: FormId
  readonly instance: InstanceId
  /** Идентификатор отправки: ключ идемпотентности. */
  readonly submissionId: SubmissionId
  /**
   * Намерение конверта, которым получен результат (действие + аргумент, как
   * в конверте). Штампуют обработчик и конвейер отправки по факту разбора
   * конверта; у результата, собранного вручную, может отсутствовать.
   */
  readonly intent?: string
  /** Прошла ли проверка и фиксация (у `queued` — принята заявка, итог позже). */
  readonly ok: boolean
  /** HTTP-код из политики статусов. */
  readonly status: number
  /** Четыре значения, и ни одного «наверное». */
  readonly outcome: Outcome
  /** Ошибки ПОКАЗА: уже через обработчик. */
  readonly errors: readonly FormError[]
  /** Некритичные серверные сбои после фиксации (например, after()). */
  readonly warnings?: readonly FormError[]
  /** Значения без секретных полей. */
  readonly values: Record<string, unknown>
  /**
   * Подсказки сервера к полям, значение которых изменил `prepare` («Текст изменён:
   * удалены ссылки»). Текст задаёт приложение; живут до следующей отправки.
   */
  readonly notes?: Readonly<Record<string, string>>
  /** Данные успешного действия. */
  readonly data?: TData
  /** Переход: только относительный и только из проверенных значений. */
  readonly redirect?: string
  /** Ревизия описания, которой соответствует результат. */
  readonly revision: Revision
  /** Как пришёл результат. Свойство результата, а не момент отрисовки. */
  readonly from: 'action' | 'fetch'
}


/**
 * Исход окончателен для этого `submissionId` (зафиксировано, неизвестно, принято в
 * очередь): следующая отправка — новая операция с новым id, иначе сервер вернёт кэш.
 */
export const isSettled = (r: Result): boolean =>
  r.outcome === 'committed' || r.outcome === 'unknown' || r.outcome === 'queued'

/**
 * FNV-1a по стабильной сериализации: одинаковые параметры — одинаковый `id`.
 * @param x Любое сериализуемое значение.
 */
export function hash(x: unknown): string {
  const s = stableStringify(x)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}

/**
 * Сериализация с сортировкой ключей: два равных объекта дают равные строки.
 * @param x Любое значение.
 */
export function stableStringify(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null'
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`
  return `{${Object.keys(x as object).sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((x as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

/** Стабильный идентификатор ошибки — по нему показ отличает «та же ошибка» от новой. */
export const stableId = (e: { path?: string; code: string; params?: unknown }) =>
  `${e.path ?? '*'}:${e.code}:${hash(e.params ?? null)}`

/** Функция подстановки параметров в текст сообщения (словарь приложения). */
export type RenderMessage = (
  code: string, params?: Record<string, unknown>,
  /** `path` — для ключа «поле:код» в словаре; `template` — свой текст ошибки. */
  at?: { path?: FieldPath; template?: string },
) => string

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)

/**
 * Присвоить тексты по словарю, убрать дубли, обрезать по пределам и
 * отсортировать стабильно — по пути, затем по коду: иначе два пути отправки давали
 * бы разные списки, и сравнение путей ловило бы шум вместо расхождения.
 * @param errors Ошибки-факты с кодами.
 * @param render Словарь текстов.
 * @param limits Пределы количества и длины сообщения.
 */
export function normalizeErrors(
  errors: readonly FormError[], render: RenderMessage,
  limits: LimitPolicy = defaultPolicy.limits,
): FormError[] {
  const seen = new Set<string>()
  const out: FormError[] = []
  for (const e of errors) {
    const id = stableId(e)
    if (seen.has(id)) continue
    seen.add(id)
    // словарь не знает кода чужой службы и не обязан: готовый текст не затираем
    const rendered = render(e.code, e.params, { path: e.path, template: e.template })
    const message = rendered === e.code && e.message && e.message !== e.code ? e.message : rendered
    out.push({ ...e, id, message: clip(message, limits.messageLength) })
    if (out.length >= limits.errors) break
  }
  return out.sort((a, b) => {
    const pa = a.path ?? '', pb = b.path ?? ''
    if (pa !== pb) return pa < pb ? -1 : 1
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })
}
