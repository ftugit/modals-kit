import { createMemo, createSignal } from 'solid-js'
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

export interface SolidFormSettings<TData = unknown> {
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

export type SolidInputProps = HtmlAttrs & {
  name: string
  id: string
  onBlur: () => void
  onInput: (event: InputEvent & { currentTarget: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement }) => void
}

export interface SolidFieldView {
  descriptor: FieldDescriptor
  skipped: ReturnType<FormDescription['attrsOf']>['skipped']
  errors(): readonly FormError[]
  hasError(): boolean
  labelProps(): { for: string }
  helpProps(): { id: string } | undefined
  errorProps(): { id: string; role: 'alert' } | undefined
  inputProps(): SolidInputProps
}

export function createSolidForm<TDefaults = unknown>(defaults: SolidFormSettings<TDefaults> = {}) {
  return function useLibForm<TData = TDefaults>(
    description: FormDescription,
    options: SolidFormSettings<TData> = {},
  ) {
    const settings: SolidFormSettings<TData> = { ...(defaults as unknown as SolidFormSettings<TData>), ...options }
    const instance = settings.instance ?? defaultInstance(description)
    const render = settings.render ?? makeRenderer([description.messages, ru], description.policy.interpolate)
    const [values, setValues] = createSignal<Record<string, unknown>>(initialValues(description))
    const [touched, setTouched] = createSignal<Record<string, true>>({})
    const [facts, setFacts] = createSignal<readonly FormError[]>([])
    const [shown, setShown] = createSignal<readonly FormError[]>([])
    const [pending, setPending] = createSignal(false)
    const [result, setResult] = createSignal<Result<TData> | undefined>()
    const submissionId = crypto.randomUUID()

    const common = createMemo(() => split(shown()).common)
    const byField = createMemo(() => split(shown()).byField)

    const display = (errors: readonly FormError[], result?: Result<TData>, intent = 'submit') => {
      const ctx = { from: result?.from ?? 'fetch', intent, outcome: result?.outcome ?? 'not-applied' } as const
      return applyHandler(errors, ctx, settings.onErrors).errors
    }

    const applyResult = (next: Result<TData>, intent: string) => {
      setFacts(next.errors)
      setShown(display(next.errors, next, intent))
      setValues((old) => ({ ...old, ...next.values }))
      setResult(() => next)
    }

    async function onSubmit(event: SubmitEvent) {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const submitter = event.submitter as HTMLButtonElement | null
      const data = new FormData(form, submitter)
      const intent = intentAction(description, data)
      const local = evaluate(data, description, { render, instance })
      if (local.errors.length || !settings.submitOnServer) {
        setFacts(local.errors)
        setShown(display(local.errors, undefined, intent))
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

    function field(name: string): SolidFieldView {
      const descriptor = description.byName[name]
      if (!descriptor) throw new Error(`Unknown field: ${name}`)
      const id = `${description.id}-${name.replace(/\./g, '-')}`
      const projected = description.attrsOf(name)
      const helpId = `${id}-help`
      const errorId = `${id}-error`
      const errors = () => byField()[name] ?? []
      const invalid = () => hasError(
        name,
        facts(),
        shown(),
        settings.invalidFrom ?? invalidFromFor(name, description, description.invalidFrom),
      )

      return {
        descriptor,
        skipped: projected.skipped,
        errors,
        hasError: invalid,
        labelProps: () => ({ for: id }),
        helpProps: () => (descriptor.help ? { id: helpId } : undefined),
        errorProps: () => (errors().length ? { id: errorId, role: 'alert' as const } : undefined),
        inputProps: () => {
          const value = values()[name] ?? descriptor.defaultValue ?? ''
          const describedBy = [descriptor.help ? helpId : undefined, errors().length ? errorId : undefined]
            .filter(Boolean).join(' ') || undefined
          const attrs: SolidInputProps = {
            ...projected.attrs,
            name,
            id,
            placeholder: descriptor.placeholder,
            'aria-invalid': invalid() || undefined,
            'aria-errormessage': errors().length ? errorId : undefined,
            'aria-describedby': describedBy,
            onBlur: () => setTouched((old) => ({ ...old, [name]: true })),
            onInput: (event) => {
              const target = event.currentTarget
              const raw = target instanceof HTMLInputElement && target.type === 'checkbox'
                ? target.checked
                : target.value
              setValues((old) => ({ ...old, [name]: raw }))
            },
          }
          if (descriptor.kind === 'checkbox') attrs.checked = Boolean(value)
          else attrs.value = String(value)
          return attrs
        },
      }
    }

    return {
      state: { pending, values, facts, shown, result },
      formProps: () => ({
        method: 'post' as const,
        action: settings.action ?? '',
        enctype: 'multipart/form-data' as const,
        onSubmit,
        'aria-busy': pending() || undefined,
      }),
      hidden: () => Object.entries(buildEnvelope({
        formId: description.id,
        revision: description.revision,
        instance,
        submissionId,
      }, description.policy)).map(([name, value]) => ({ type: 'hidden' as const, name, value, readOnly: true as const })),
      intent: (id: string) => ({
        name: description.policy.envelopeKeys.intent,
        value: id,
        disabled: pending() || undefined,
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

function defaultInstance(description: FormDescription) {
  const normalized = description.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  const owner = (/^[a-z]/.test(normalized) ? normalized : `f_${normalized}`).slice(0, 32)
  return `${owner}:default`
}

function intentAction(description: FormDescription, data: FormData) {
  const raw = data.get(description.policy.envelopeKeys.intent)
  return description.policy.intent.parse(typeof raw === 'string' && raw ? raw : 'submit').action
}
