// Политика: всё, что раньше было зашитыми константами.
//
// Признак, по которому константа попадает сюда: от неё зависит, примет ли
// библиотека чужой код или чужие данные. Имена полей, пределы, ключи конверта,
// подстановка в сообщения — всё это границы, и приложение вправе их двигать.
// То, что не влияет на приём (внутренние коды, порядок сортировки ошибок),
// остаётся в ядре.

/** Правила имён полей и служебных ключей. */
export interface NamePolicy {
  /** Каждый СЕГМЕНТ имени обязан совпасть. */
  readonly pattern: RegExp
  readonly forbidden: ReadonlySet<string>
  readonly maxSegments: number
}

/** Лимиты описания формы и результата. */
export interface LimitPolicy {
  readonly fields: number
  readonly constraintsPerField: number
  readonly options: number
  readonly labelLength: number
  readonly helpLength: number
  readonly patternLength: number
  readonly errors: number
  readonly messageLength: number
}

/** Имена служебных hidden-полей конверта. */
export interface EnvelopeKeys {
  readonly id: string
  readonly rev: string
  readonly instance: string
  readonly submission: string
  readonly spec: string
  readonly intent: string
}

/** Канонические HTTP/status-коды результата. */
export interface StatusPolicy {
  readonly ok: number
  readonly validationFailed: number
  readonly unknown: number
  readonly aborted: number
}

/** Форматирование и разбор submit intent. */
export interface IntentPolicy {
  /** Намерение «действие[:аргумент]» — формат переопределяем. */
  format(action: string, arg?: string): string
  parse(raw: string): { action: string; arg?: string }
}

/** Все заменяемые константы ядра формы. */
export interface FormPolicy {
  readonly names: NamePolicy
  readonly limits: LimitPolicy
  readonly envelopeKeys: EnvelopeKeys
  readonly status: StatusPolicy
  readonly intent: IntentPolicy
  /** Подстановка в сообщения. Своя — если нужны падежи или множественное число. */
  interpolate(template: string, params: Record<string, unknown>): string
}

/** Политика по умолчанию. */
export const defaultPolicy: FormPolicy = {
  names: {
    pattern: /^[a-z][a-z0-9_]{0,31}$/,
    forbidden: new Set([
      '__proto__', 'prototype', 'constructor',
      '__form_id', '__form_rev', '__form_instance', '__form_submission', '__form_spec', 'intent',
    ]),
    maxSegments: 4,
  },
  limits: {
    fields: 128, constraintsPerField: 16, options: 200,
    labelLength: 120, helpLength: 500, patternLength: 256,
    errors: 25, messageLength: 280,
  },
  envelopeKeys: {
    id: '__form_id', rev: '__form_rev', instance: '__form_instance',
    submission: '__form_submission', spec: '__form_spec', intent: 'intent',
  },
  status: { ok: 200, validationFailed: 422, unknown: 0, aborted: 0 },
  intent: {
    format: (action, arg) => (arg === undefined ? action : `${action}:${arg}`),
    parse: (raw) => {
      const [action = 'submit', ...rest] = raw.split(':')
      return rest.length ? { action, arg: rest.join(':') } : { action }
    },
  },
  interpolate: (t, p) => t.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? `{${k}}`)),
}

type Patch<T> = {
  [K in keyof T]?: T[K] extends (...a: never[]) => unknown ? T[K]
    : T[K] extends object ? Partial<T[K]> : T[K]
}

/** Политика с правками поверх умолчаний. */
export function policyWith(patch: Patch<FormPolicy> = {}): FormPolicy {
  return {
    names: { ...defaultPolicy.names, ...patch.names },
    limits: { ...defaultPolicy.limits, ...patch.limits },
    envelopeKeys: { ...defaultPolicy.envelopeKeys, ...patch.envelopeKeys },
    status: { ...defaultPolicy.status, ...patch.status },
    intent: { ...defaultPolicy.intent, ...patch.intent },
    interpolate: patch.interpolate ?? defaultPolicy.interpolate,
  }
}

/** Имя составное: каждый сегмент проверяется отдельно. */
export function nameProblem(name: string, p: NamePolicy = defaultPolicy.names):
  'format' | 'forbidden' | null {
  if (p.forbidden.has(name)) return 'forbidden'
  const segments = name.split('.')
  if (segments.length > p.maxSegments) return 'format'
  for (const seg of segments) {
    if (p.forbidden.has(seg)) return 'forbidden'
    if (!p.pattern.test(seg)) return 'format'
  }
  return null
}
