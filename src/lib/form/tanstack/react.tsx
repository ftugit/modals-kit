import { useMemo, useState, type FormEvent } from 'react'
import {
  applyHandler,
  buildEnvelope,
  evaluate,
  hasError,
  invalidFromFor,
  makeRenderer,
  ru,
  split,
  type ErrorHandler,
  type FieldDescriptor,
  type FormDescription,
  type FormError,
  type HtmlAttrs,
  type InvalidFrom,
  type RenderMessage,
  type Result,
} from '../index'

export interface ReactFormSettings<TData = unknown> {
  /** URL для нативного POST без JavaScript. По умолчанию — текущий маршрут. */
  action?: string
  /** Стабильный id экземпляра формы. Должен совпадать с ожиданием сервера. */
  instance?: string
  /** Рендер сообщений по коду ошибки. По умолчанию: сообщения формы + встроенный ru-словарь. */
  render?: RenderMessage
  /** Один обработчик ошибок: переписать, удалить или перевести ошибки в общий блок. */
  onErrors?: ErrorHandler
  /** Источник aria-invalid: все факты или только показанные обработчиком ошибки. */
  invalidFrom?: InvalidFrom
  /** Серверная сторона приложения. Она снова вызывает ядро с тем же описанием. */
  submitOnServer?: (data: FormData) => Promise<Result<TData>>
}

export interface ReactFieldView {
  descriptor: FieldDescriptor
  errors: readonly FormError[]
  hasError: boolean
  skipped: ReturnType<FormDescription['attrsOf']>['skipped']
  labelProps: { htmlFor: string }
  helpProps?: { id: string }
  errorProps?: { id: string; role: 'alert' }
  inputProps: HtmlAttrs & {
    name: string
    id: string
    onBlur: () => void
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
  }
}

export interface ReactFormApi<TData = unknown> {
  state: {
    pending: boolean
    values: Record<string, unknown>
    facts: readonly FormError[]
    shown: readonly FormError[]
    result?: Result<TData>
  }
  formProps: {
    method: 'post'
    action: string
    encType: 'multipart/form-data'
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    'aria-busy'?: true
  }
  hidden(): Array<{ type: 'hidden'; name: string; value: string; readOnly: true }>
  intent(id: string): { name: string; value: string; disabled?: boolean; formNoValidate?: boolean }
  field(name: string): ReactFieldView
  common: readonly FormError[]
}

export function createReactForm<TDefaults = unknown>(defaults: ReactFormSettings<TDefaults> = {}) {
  return function useLibForm<TData = TDefaults>(
    description: FormDescription,
    options: ReactFormSettings<TData> = {},
  ): ReactFormApi<TData> {
    const settings: ReactFormSettings<TData> = { ...(defaults as unknown as ReactFormSettings<TData>), ...options }
    const instance = settings.instance ?? defaultInstance(description)
    const render = settings.render ?? makeRenderer([description.messages, ru], description.policy.interpolate)
    const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(description))
    const [touched, setTouched] = useState<Record<string, true>>({})
    const [facts, setFacts] = useState<readonly FormError[]>([])
    const [shown, setShown] = useState<readonly FormError[]>([])
    const [pending, setPending] = useState(false)
    const [result, setResult] = useState<Result<TData> | undefined>()

    const common = useMemo(() => split(shown).common, [shown])
    const byField = useMemo(() => split(shown).byField, [shown])
    const submissionId = useMemo(() => crypto.randomUUID(), [])

    const display = (errors: readonly FormError[], result?: Result<TData>, intent = 'submit') => {
      const ctx = { from: result?.from ?? 'fetch', intent, outcome: result?.outcome ?? 'not-applied' } as const
      return applyHandler(errors, ctx, settings.onErrors).errors
    }

    const applyResult = (next: Result<TData>, intent: string) => {
      const nextShown = display(next.errors, next, intent)
      setFacts(next.errors)
      setShown(nextShown)
      setValues((old) => ({ ...old, ...next.values }))
      setResult(next)
    }

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
      const data = new FormData(event.currentTarget, submitter)
      const intent = intentAction(description, data)
      const local = evaluate(data, description, { render, instance })
      if (local.errors.length || !settings.submitOnServer) {
        const next = local.errors.length ? local.errors : []
        setFacts(next)
        setShown(display(next, undefined, intent))
        setValues((old) => ({ ...old, ...local.publicValues }))
        return
      }

      setPending(true)
      try {
        applyResult(await settings.submitOnServer(data), intent)
      } finally {
        setPending(false)
      }
    }

    function field(name: string): ReactFieldView {
      const descriptor = description.byName[name]
      if (!descriptor) throw new Error(`Unknown field: ${name}`)
      const id = `${description.id}-${name.replace(/\./g, '-')}`
      const errors = byField[name] ?? []
      const invalidMode = settings.invalidFrom ?? invalidFromFor(name, description, description.invalidFrom)
      const invalid = hasError(name, facts, shown, invalidMode)
      const helpId = `${id}-help`
      const errorId = `${id}-error`
      const projected = description.attrsOf(name)
      const value = values[name] ?? descriptor.defaultValue ?? ''
      const describedBy = [descriptor.help ? helpId : undefined, errors.length ? errorId : undefined]
        .filter(Boolean).join(' ') || undefined

      const attrs: ReactFieldView['inputProps'] = {
        ...toReactAttrs(projected.attrs),
        name,
        id,
        placeholder: descriptor.placeholder,
        'aria-invalid': invalid || undefined,
        'aria-errormessage': errors.length ? errorId : undefined,
        'aria-describedby': describedBy,
        onBlur: () => setTouched((old) => ({ ...old, [name]: true })),
        onChange: (event) => {
          const target = event.currentTarget
          const raw = target instanceof HTMLInputElement && target.type === 'checkbox'
            ? target.checked
            : target.value
          setValues((old) => ({ ...old, [name]: raw }))
        },
      }
      if (descriptor.kind === 'checkbox') attrs.checked = Boolean(value)
      else attrs.value = String(value)

      return {
        descriptor,
        errors,
        hasError: invalid,
        skipped: projected.skipped,
        labelProps: { htmlFor: id },
        helpProps: descriptor.help ? { id: helpId } : undefined,
        errorProps: errors.length ? { id: errorId, role: 'alert' } : undefined,
        inputProps: attrs,
      }
    }

    return {
      state: { pending, values, facts, shown, result },
      formProps: {
        method: 'post',
        action: settings.action ?? '',
        encType: 'multipart/form-data',
        onSubmit,
        ...(pending ? { 'aria-busy': true as const } : {}),
      },
      hidden: () => Object.entries(buildEnvelope({
        formId: description.id,
        revision: description.revision,
        instance,
        submissionId,
      }, description.policy)).map(([name, value]) => ({ type: 'hidden' as const, name, value, readOnly: true as const })),
      intent: (id: string) => ({
        name: description.policy.envelopeKeys.intent,
        value: id,
        disabled: pending || undefined,
        formNoValidate: description.actions.find((a) => a.id === description.policy.intent.parse(id).action)?.validate === 'none' || undefined,
      }),
      field,
      common,
    }
  }
}

function initialValues(description: FormDescription) {
  const out: Record<string, unknown> = {}
  for (const field of description.fields) if (field.defaultValue !== undefined) out[field.name] = field.defaultValue
  return out
}

function toReactAttrs(attrs: HtmlAttrs): HtmlAttrs {
  const aliases: Record<string, string> = {
    minlength: 'minLength',
    maxlength: 'maxLength',
    inputmode: 'inputMode',
    autocomplete: 'autoComplete',
    autofocus: 'autoFocus',
    readonly: 'readOnly',
    spellcheck: 'spellCheck',
    novalidate: 'noValidate',
    formnovalidate: 'formNoValidate',
  }
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [aliases[key] ?? key, value]))
}

function defaultInstance(description: FormDescription) {
  const normalized = description.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  const owner = (/^[a-z]/.test(normalized) ? normalized : `f_${normalized}`).slice(0, 32)
  return `${owner}:default`
}

function intentAction(description: FormDescription, data: FormData) {
  const raw = data.get(description.policy.envelopeKeys.intent)
  return description.policy.intent.parse(typeof raw === 'string' && raw ? raw : 'submit').action
}
