import {
  createRegistry,
  defineForm,
  describe,
  evaluate,
  issue,
  makeFieldSugar,
  makeRenderer,
  normalizeErrors,
  normalizeService,
  ru,
  stableId,
  v,
  type Constraint,
  type ErrorInstruction,
  type FieldType,
  type FormDescription,
  type FormError,
} from '@modals-kit/form'

declare module '@modals-kit/form' {
  interface FieldValues { rating: number | null }
  interface InputModes { rating: true }
}

const asAny = (x: Constraint) => x as Constraint & Record<string, unknown>

type JsonPrimitive = string | number | boolean | null
type JsonObject = { readonly [key: string]: JsonValue }
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject

type SerializableFormError = {
  readonly id: string
  readonly code: string
  readonly message?: string
  readonly params?: JsonObject
  readonly path?: string
  readonly origin: 'core' | 'server' | 'external'
  readonly source?: JsonValue
  readonly silent?: boolean
  readonly retryable?: boolean
}

export type SignupServerResult = {
  readonly v: 1
  readonly formId: string
  readonly instance: string
  readonly submissionId: string
  readonly ok: boolean
  readonly status: number
  readonly outcome: 'not-applied' | 'committed' | 'unknown' | 'queued'
  readonly errors: readonly SerializableFormError[]
  readonly values: JsonObject
  readonly data?: { readonly saved: true; readonly received: JsonObject }
  readonly redirect?: string
  readonly revision: number
  readonly from: 'action' | 'fetch'
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (value && typeof value === 'object') return toJsonObject(value as Record<string, unknown>)
  return null
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  const out: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = toJsonValue(item)
  }
  return out
}

function serializableError(error: FormError): SerializableFormError {
  const out: {
    id: string
    code: string
    message?: string
    params?: JsonObject
    path?: string
    origin: 'core' | 'server' | 'external'
    source?: JsonValue
    silent?: boolean
    retryable?: boolean
  } = {
    id: error.id,
    code: error.code,
    origin: error.origin,
  }
  if (error.message !== undefined) out.message = error.message
  if (error.params !== undefined) out.params = toJsonObject(error.params)
  if (error.path !== undefined) out.path = error.path
  if (error.source !== undefined) out.source = toJsonValue(error.source)
  if (error.silent !== undefined) out.silent = error.silent
  if (error.retryable !== undefined) out.retryable = error.retryable
  return out
}

/** Свой тип значения: библиотека не знает `rating`, его регистрирует приложение. */
export const ratingType: FieldType<number | null> = {
  kind: 'rating',
  inputs: ['rating', 'range'],
  multiple: false,
  empty: null,
  decode(entries) {
    let raw: string | undefined
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (typeof entry === 'string') { raw = entry; break }
    }
    if (raw === undefined || raw === '') return { ok: true, value: null }
    const value = Number(raw)
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, code: 'number' }
  },
  encode(value, name, out) {
    if (value !== null) out.push([name, String(value)])
  },
  constraints: {
    required: true,
    minMagnitude: (c) => ({ min: String(asAny(c).value) }),
    maxMagnitude: (c) => ({ max: String(asAny(c).value) }),
    step: (c) => ({ step: String(asAny(c).value) }),
  },
  attrs: () => ({ type: 'range' }),
  degradation: { withoutJs: 'input[type=range]' },
}

/** Свой валидатор с describe(): его ограничение попадает в HTML pattern. */
export const taxId = () => describe<string>(
  (value) => (!value || /^\d{10}$|^\d{12}$/.test(value) ? null : issue('tax_id')),
  [{ kind: 'pattern', source: '\\d{10}|\\d{12}' }],
)

/** Свой валидатор без describe(): работает на обеих сторонах, но не даёт атрибут. */
export const luhn = () => (value: string) => {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum > 0 && sum % 10 === 0 ? null : issue('card')
}

export const registry = createRegistry()
  .registerType(ratingType)
  .registerValidator('taxId', () => taxId())
  .registerValidator('luhn', () => luhn())

export const formField = makeFieldSugar(registry)

export const signupForm = defineForm({
  id: 'signup',
  revision: 1,
  registry,
  cardinality: 'all',
  messages: {
    required: 'Обязательное поле',
    email: 'Почта выглядит неверно',
    minLength: 'Минимум {min} символов',
    strength: 'Пароль слабый: нужен уровень {need}',
    sameAs: 'Значения не совпадают',
    minValue: 'Минимум {min}',
    maxValue: 'Максимум {max}',
    tax_id: 'ИНН — 10 или 12 цифр',
    card: 'Номер карты не проходит Luhn',
    'external.EMAIL_TAKEN': 'Эта почта уже занята внешней службой',
    'external.LUHN_FAILED': 'Платёжная служба отклонила карту',
    'service.502': 'Служба вернула неожиданный ответ',
  },
  actions: [
    { id: 'submit', label: 'Создать аккаунт', validate: 'full' },
    { id: 'save-draft', label: 'Сохранить черновик', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    email: formField.email({
      label: 'Почта',
      placeholder: 'you@example.com',
      help: 'taken@example.com имитирует ошибку внешней службы',
      validate: [v.required(), v.email(), v.maxLength(320)],
    }),
    password: formField.password({
      label: 'Пароль',
      help: 'minLength есть в HTML, strength остаётся проверкой ядра/сервера',
      validate: [v.required(), v.minLength(10), v.strength('good')],
    }),
    confirm: formField.password({
      label: 'Повторите пароль',
      help: 'sameAs не выражается HTML-атрибутом',
      validate: [v.required(), v.sameAs('password')],
    }),
    age: formField.number({
      label: 'Возраст',
      defaultValue: 30,
      validate: [v.required(), v.minValue(18), v.maxValue(120)],
    }),
    rating: formField.rating({
      label: 'Оценка',
      defaultValue: 3,
      validate: [v.minValue(1), v.maxValue(5), v.step(1)],
    }),
    tax_id: formField.text({
      label: 'ИНН',
      help: 'Свой валидатор с HTML pattern',
      validate: [{ name: 'taxId' }],
    }),
    card: formField.text({
      label: 'Карта',
      help: 'Свой валидатор без describe: атрибута pattern нет',
      validate: [{ name: 'luhn' }],
    }),
    agree: formField.checkbox({
      label: 'Согласен с условиями',
      validate: [v.required()],
    }),
  },
})

export const externalInstruction: ErrorInstruction = {
  id: 'billing-api',
  parse: ({ body }) => {
    if (!body || typeof body !== 'object' || !Array.isArray((body as { errors?: unknown }).errors)) return null
    return (body as { errors: Array<{ code?: string; field?: string; message?: string }> }).errors
  },
  aliases: { user_email: 'email', card_number: 'card' },
  codeAliases: { EMAIL_TAKEN: 'email' },
  messages: {
    EMAIL_TAKEN: 'Эта почта уже занята внешней службой',
    LUHN_FAILED: 'Платёжная служба отклонила карту',
    'service.502': 'Служба вернула неожиданный ответ',
  },
}

export const renderMessage = makeRenderer([signupForm.messages, ru], signupForm.policy.interpolate)
export const FORM_INSTANCE = 'tanstack:start'

export function constraintRows(description: FormDescription = signupForm) {
  return description.fields.flatMap((field) => {
    const projected = description.attrsOf(field.name)
    return description.constraintsOf(field.name).map((constraint) => ({
      field: field.name,
      constraint: constraint.kind,
      attr: Object.keys(projected.attrs).join(', ') || '—',
      skipped: projected.skipped.find((s) => s.kind === constraint.kind)?.why ?? '',
    }))
  })
}

export function externalPreview(recognized = true): readonly FormError[] {
  return normalizeService({
    status: recognized ? 409 : 502,
    instruction: externalInstruction,
    body: recognized
      ? { errors: [{ code: 'EMAIL_TAKEN', field: 'user_email' }, { code: 'LUHN_FAILED', field: 'card_number' }] }
      : { fault: 'html gateway page' },
  })
}

export async function submitSignupOnServer(data: FormData): Promise<SignupServerResult> {
  await new Promise((resolve) => setTimeout(resolve, 220))
  const evaluated = evaluate(data, signupForm, {
    render: renderMessage,
    instance: FORM_INSTANCE,
  })

  const external: FormError[] = []
  if (!evaluated.errors.length && evaluated.values.email === 'taken@example.com') {
    external.push(...externalPreview(true))
  }

  const errors = normalizeErrors([...evaluated.errors, ...external], renderMessage, signupForm.policy.limits)
  const ok = errors.length === 0
  const values = toJsonObject(evaluated.publicValues)
  return {
    v: 1,
    formId: signupForm.id,
    instance: FORM_INSTANCE,
    submissionId: String(data.get(signupForm.policy.envelopeKeys.submission) ?? crypto.randomUUID()),
    ok,
    status: ok ? signupForm.policy.status.ok : signupForm.policy.status.validationFailed,
    outcome: ok ? 'committed' : 'not-applied',
    errors: errors.map(serializableError),
    values,
    data: ok ? { saved: true, received: values } : undefined,
    revision: signupForm.revision,
    from: 'fetch',
  }
}

export function clientOnlyFailure(code: string, path?: string): FormError {
  return { id: stableId({ path, code }), code, path, origin: 'core', message: renderMessage(code) }
}
