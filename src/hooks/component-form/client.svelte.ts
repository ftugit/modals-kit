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
import { visibleAddress } from '#lib/address/sveltekit.js'
import { bind, type BoundConfig, type BoundForm } from '#lib/form/svelte/index.js'
import { kitActionTransport } from '#lib/components/form/transport.js'
import { buildEnvelope, type FormDescription, type Result, type Transport } from '#lib/form/index.js'
import type { ComponentFormOptions, FormSessionGuard } from './types.js'

export type { FormSessionGuard }

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
  const { action, prepare, continuation, session, ...rest } = options
  const target = untrack(() => action ?? readCurrentHref())
  const initialContinuation = untrack(() => continuation ?? readPageFormResult(desc.id))
  const baseTransport = kitActionTransport(target, prepare ? { prepare } : {})

  const transport: Transport = async (req) => {
    if (session) {
      await session.ensureFresh()
    }
    const out = await baseTransport(req)
    if (session && out.kind === 'result' && isAuthExpiredResult(out.result)) {
      const renewed = await session.onAuthExpired()
      if (renewed) {
        const retryEnvelope = { ...req.envelope, submissionId: crypto.randomUUID() }
        const retryData = req.data instanceof FormData ? cloneFormDataWithEnvelope(req.data, desc, retryEnvelope) : req.data
        const retryOut = await baseTransport({
          ...req,
          envelope: retryEnvelope,
          data: retryData,
        })
        if (retryOut.kind === 'result') {
          return {
            kind: 'result',
            result: { ...retryOut.result, submissionId: req.envelope.submissionId },
          }
        }
        return retryOut
      }
    }
    return out
  }

  return bind(cfg, desc, {
    ...rest,
    action: target,
    transport,
    continuation: initialContinuation,
  })
}
