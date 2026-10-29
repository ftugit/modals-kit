// Клиентская привязка встраиваемой формы компонента к текущему маршруту.
//
// Где бы ни рендерился компонент (страница, модалка поверх любого маршрута,
// шаг виджета), его `<form method="post" action={target}>` и JS-транспорт
// указывают ровно на текущий видимый адрес (`pathname + search`),
// `continuation` подхватывает `page.data.formResult` при нативном POST,
// а явно переданный `session` прозрачно обновляет мёртвый временный токен
// и повторяет запрос 1 раз без потери введённых пользователем данных.
import { untrack } from 'svelte'
import { page } from '$app/state'
import { visibleAddress, writeAddress } from '#lib/address/sveltekit.js'
import { bind, type BindOptions, type BoundConfig, type BoundForm } from '#lib/form/svelte/index.js'
import { kitActionTransport } from './transport.js'
import { registerFormUploadFields } from './upload-progress.svelte.js'
import { hasUploadableFiles, wsFormTransport } from './ws-transport.js'
import { buildEnvelope, type FormDescription, type Result, type Transport } from '#lib/form/index.js'
import type { ComponentFormOptions, FormSessionGuard } from './types.js'

export type { FormSessionGuard }

/** Активные контроллеры пользовательской отмены отправки по экземпляру `BoundForm`. */
const activeSubmitControllers = new WeakMap<BoundForm, AbortController>()

/**
 * Отменить текущую активную отправку/загрузку формы без размонтирования формы и без очистки введённых полей.
 * Следующая отправка автоматически откроет новое `wss://`-соединение с новым серверным таймером.
 */
export function cancelComponentFormUpload(form: BoundForm): boolean {
  const controller = activeSubmitControllers.get(form)
  if (!controller || controller.signal.aborted) return false
  controller.abort('user-cancelled')
  activeSubmitControllers.delete(form)
  return true
}

function createLinkedAbortController(parent?: AbortSignal): {
  controller: AbortController
  cleanup: () => void
} {
  const controller = new AbortController()
  if (!parent) {
    return { controller, cleanup: () => {} }
  }
  if (parent.aborted) {
    controller.abort(parent.reason)
    return { controller, cleanup: () => {} }
  }
  const onParentAbort = () => controller.abort(parent.reason)
  parent.addEventListener('abort', onParentAbort, { once: true })
  return {
    controller,
    cleanup: () => parent.removeEventListener('abort', onParentAbort),
  }
}

function isAuthExpiredResult(result: Result): boolean {
  if (result.ok) return false
  if (result.errors.some((m) => m.code === 'auth.expired')) return true
  const data = result.data as { code?: unknown } | undefined
  return data?.code === 'auth.expired'
}

function readCurrentHref(): string {
  try {
    const u = visibleAddress().url
    return (u.pathname || '/') + u.search
  } catch {
    return '/'
  }
}

function readPageFormResult(expectedFormId: string): Result | null {
  try {
    const candidate = (page.data as { formResult?: Result | null } | undefined)?.formResult ?? null
    return candidate && candidate.formId === expectedFormId ? candidate : null
  } catch {
    return null
  }
}

function cloneFormDataWithEnvelope(
  source: FormData,
  desc: FormDescription,
  nextEnvelope: Parameters<Transport>[0]['envelope'],
): FormData {
  const copy = new FormData()
  const keys = desc.policy.envelopeKeys
  const reserved = new Set<string>(Object.values(keys))
  for (const [k, v] of source.entries()) {
    if (!reserved.has(k)) copy.append(k, v)
  }
  for (const [k, v] of Object.entries(buildEnvelope(nextEnvelope, desc.policy))) {
    copy.set(k, v)
  }
  copy.set(keys.intent, nextEnvelope.intent)
  return copy
}

export function bindComponentForm(
  cfg: BoundConfig,
  desc: FormDescription,
  options: ComponentFormOptions = {},
): BoundForm {
  // Опции читаются ЖИВЫМИ: панель демо отдаёт их геттерами (`get invalidFrom()`),
  // и деструктуризация `{ ...rest }` превратила бы каждое в снимок на момент
  // связывания — переключатель перестал бы действовать до перезагрузки.
  // Поэтому свои ключи перекрываются, а остальные приходят по прототипу.
  const { action, prepare, continuation, session, lockStateKey, onSuccess } = options
  const resolveTarget = () => action ?? readCurrentHref()
  const initialContinuation = untrack(() => continuation ?? readPageFormResult(desc.id))
  const httpTransport = kitActionTransport(resolveTarget)
  const wsTransport = wsFormTransport(resolveTarget)
  let boundFormRef: BoundForm | null = null

  const baseTransport: Transport = async (req) => {
    if (prepare && req.data instanceof FormData) {
      await prepare(req.data)
    }
    if (hasUploadableFiles(req.data) && typeof WebSocket === 'function') {
      return wsTransport(req)
    }
    return httpTransport(req)
  }
  let lastResult: Result | null = initialContinuation

  const transport: Transport = async (req) => {
    const linked = createLinkedAbortController(req.signal)
    if (boundFormRef) {
      activeSubmitControllers.set(boundFormRef, linked.controller)
    }
    const cancellableReq = { ...req, signal: linked.controller.signal }

    try {
      if (session) {
        await session.ensureFresh()
      }
      if (linked.controller.signal.aborted) {
        return { kind: 'abort', reason: 'aborted' }
      }
      const out = await baseTransport(cancellableReq)
      if (session && out.kind === 'result' && isAuthExpiredResult(out.result)) {
        const renewed = await session.onAuthExpired()
        if (renewed && !linked.controller.signal.aborted) {
          const retryEnvelope = { ...cancellableReq.envelope, submissionId: crypto.randomUUID() }
          const retryData =
            cancellableReq.data instanceof FormData
              ? cloneFormDataWithEnvelope(cancellableReq.data, desc, retryEnvelope)
              : cancellableReq.data
          const retryOut = await baseTransport({
            ...cancellableReq,
            envelope: retryEnvelope,
            data: retryData,
          })
          if (retryOut.kind === 'result') {
            const merged = { ...retryOut.result, submissionId: req.envelope.submissionId }
            lastResult = merged
            return { kind: 'result', result: merged }
          }
          return retryOut
        }
      }
      if (out.kind === 'result') lastResult = out.result
      return out
    } finally {
      linked.cleanup()
      if (boundFormRef && activeSubmitControllers.get(boundFormRef) === linked.controller) {
        activeSubmitControllers.delete(boundFormRef)
      }
    }
  }

  const form = bind(
    cfg,
    desc,
    Object.create(options, {
      action: { value: resolveTarget, enumerable: true, configurable: true },
      transport: { value: transport, enumerable: true, configurable: true },
      continuation: { value: initialContinuation, enumerable: true, configurable: true },
    }) as BindOptions,
  )
  boundFormRef = form

  $effect(() => registerFormUploadFields(form))

  if (lockStateKey) {
    let applied = false
    $effect(() => {
      const pending = form.state.pending
      if (pending === applied) return
      applied = pending
      void writeAddress(
        (cur) => ({ url: cur.url.href, state: { ...cur.state, [lockStateKey]: pending } }),
        { replace: true, load: false },
      )
      return () => {
        if (!applied) return
        applied = false
        void writeAddress(
          (cur) => ({ url: cur.url.href, state: { ...cur.state, [lockStateKey]: false } }),
          { replace: true, load: false },
        )
      }
    })
  }

  if (onSuccess) {
    let seenStatus = untrack(() => form.state.status)
    $effect(() => {
      const now = form.state.status
      if (now === seenStatus) return
      seenStatus = now
      if (now === 'success' && form.state.outcome !== 'not-applied' && lastResult) {
        onSuccess(lastResult)
      }
    })
  }

  return form
}
