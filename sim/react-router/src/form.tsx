/**
 * `#lib/form` under React: the smallest controller that exercises the core —
 * fields drawn from the description, the same `evaluate` before sending,
 * `runSubmit` through a Transport, server errors on their fields.
 *
 * What the Svelte controller (`svelte/bind.svelte.ts`, ~650 lines) does beyond
 * this — live validation on blur/input, async checks, pinned server errors,
 * schema mutations, focus management, dirty/touched — is framework-free logic
 * that a React port would have to copy (audit finding: `form/controller.ts`).
 */
import { useMemo, useRef, useSyncExternalStore, type FormEvent } from 'react'
import {
  evaluate,
  FormStore,
  initialState,
  runSubmit,
  SubmitMachine,
  type FieldDescriptor,
  type FormDescription,
  type FormError,
  type MessageDictionary,
  type Result,
  type Transport,
} from '#lib/form/index.js'
// Not part of the public index — every controller needs it (audit finding).
import { formRenderer } from '#lib/form/messages-order.js'
import { createFormHandler } from '#lib/form/server.js'

/**
 * The core projects constraints to HTML attribute names (`maxlength`, `inputmode`).
 * React wants DOM property casing; without this table React warns and, for
 * `maxlength`, still sets the attribute — but the names are not React's.
 */
const REACT_NAME: Record<string, string> = {
  maxlength: 'maxLength',
  minlength: 'minLength',
  inputmode: 'inputMode',
  autocomplete: 'autoComplete',
  readonly: 'readOnly',
  for: 'htmlFor',
  class: 'className',
  tabindex: 'tabIndex',
}
export function reactAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [REACT_NAME[k] ?? k, v]))
}

/** In-process transport: the real server handler, no network. */
export function handlerTransport(
  description: FormDescription,
  execute: Parameters<typeof createFormHandler>[0]['execute'],
  messages?: MessageDictionary,
): Transport {
  const handle = createFormHandler({ description, execute, messages })
  return async (req) => {
    const request = new Request('http://sim.local/form', {
      method: 'POST',
      body: req.data,
      headers: { accept: 'application/json' },
    })
    const handled = await handle(request, 'fetch')
    return { kind: 'result', result: handled.result }
  }
}

export function useForm(description: FormDescription, o: { transport: Transport; messages?: MessageDictionary }) {
  const kit = useMemo(() => {
    const render = formRenderer(description.messages as never, o.messages, description.policy.interpolate)
    const store = new FormStore(initialState(description.revision))
    const machine = new SubmitMachine('block')
    return { render, store, machine }
  }, [description]) // eslint-disable-line react-hooks/exhaustive-deps
  const state = useSyncExternalStore(kit.store.subscribe, kit.store.getSnapshot, kit.store.getSnapshot)
  const last = useRef<Result | null>(null)
  const instance = `${description.id}:new`

  const show = (errors: readonly FormError[], status: 'error' | 'success') =>
    kit.store.set((s) => ({ ...s, status, pending: false, facts: errors, shown: errors }))

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    // The same check the server runs — before anything leaves the page.
    const local = evaluate(data, description, { render: kit.render, instance, requireEnvelope: false })
    if (local.errors.length) return show(local.errors, 'error')

    const begun = await kit.machine.acquire(description.revision, 'submit', crypto.randomUUID())
    if (!begun.go) return
    kit.store.set((s) => ({ ...s, status: 'submitting', pending: true, submitCount: s.submitCount + 1 }))
    const result = await runSubmit({
      description,
      data,
      instance,
      submission: begun.submission,
      transport: o.transport,
      render: kit.render,
    })
    kit.machine.finish(begun.submission)
    last.current = result
    show(result.errors, result.ok ? 'success' : 'error')
  }

  const errorsOf = (name: string) => state.shown.filter((err) => err.path === name)
  const general = state.shown.filter((err) => !err.path)
  return { state, onSubmit, errorsOf, general, last }
}

/** Fields drawn from the description: label, control with projected attrs, errors. */
export function SimForm({
  description,
  transport,
  messages,
  submitLabel,
}: {
  description: FormDescription
  transport: Transport
  messages?: MessageDictionary
  /** The app owns the words. */
  submitLabel: string
}) {
  const form = useForm(description, { transport, messages })
  return (
    <form noValidate onSubmit={form.onSubmit} data-status={form.state.status}>
      {description.fields.map((f) => (
        <Field key={f.name} field={f} description={description} errors={form.errorsOf(f.name)} />
      ))}
      {form.general.map((err) => (
        <p key={err.id} role="alert" data-general>
          {err.message}
        </p>
      ))}
      <button type="submit" disabled={form.state.pending}>
        {submitLabel}
      </button>
    </form>
  )
}

function Field({
  field,
  description,
  errors,
}: {
  field: FieldDescriptor
  description: FormDescription
  errors: readonly FormError[]
}) {
  const id = `f-${field.name}`
  const attrs = reactAttrs(description.attrsOf(field.name).attrs as Record<string, unknown>)
  const errId = errors.length ? `${id}-err` : undefined
  return (
    <div data-field={field.name}>
      <label htmlFor={id}>{field.label}</label>
      <input
        id={id}
        name={field.name}
        defaultValue={field.defaultValue == null ? undefined : String(field.defaultValue)}
        aria-invalid={errors.length ? true : undefined}
        aria-describedby={errId}
        {...attrs}
      />
      {errors.length > 0 && (
        <p id={errId} data-error>
          {errors.map((err) => err.message).join(' ')}
        </p>
      )}
    </div>
  )
}
