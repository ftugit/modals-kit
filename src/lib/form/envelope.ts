// Конверт: что форма сообщает о себе серверу. Проверка строгая — отказ,
// а не молчаливая починка. Имена ключей и формат намерения — из политики.
import type { EntrySource } from './decode'
import type { FormDescription } from './describe'
import { defaultPolicy, type FormPolicy } from './policy'
import type { FormId, InstanceId, Revision, SubmissionId } from './types'

export interface Envelope {
  formId: FormId
  revision: Revision
  instance: InstanceId
  submissionId: SubmissionId
  intent: string
  specVersion?: number
}

export type EnvelopeVerdict =
  | { ok: true; envelope: Envelope }
  | { ok: false; code: string; detail: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INSTANCE_RE = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9_-]{1,64}$/

/** Конверт присутствует в разметке ДО оживления: он не привилегия JS-пути. */
export function buildEnvelope(e: Omit<Envelope, 'intent'>,
                              policy: FormPolicy = defaultPolicy): Record<string, string> {
  const k = policy.envelopeKeys
  const out: Record<string, string> = {
    [k.id]: e.formId,
    [k.rev]: String(e.revision),
    [k.instance]: e.instance,
    [k.submission]: e.submissionId,
  }
  if (e.specVersion !== undefined) out[k.spec] = String(e.specVersion)
  return out
}

/**
 * Проверить конверт в присланных данных. Отказ, а не молчаливая починка.
 * @param form Данные запроса.
 * @param d Описание формы.
 * @param expect Ожидаемый экземпляр, если форма адресована.
 * @returns Либо конверт, либо код отказа с подробностью.
 */
export function verifyEnvelope(
  form: EntrySource, d: FormDescription, expect: { instance?: InstanceId } = {},
): EnvelopeVerdict {
  const k = d.policy.envelopeKeys
  const get = (key: string) => {
    const v = form.getAll(key)[0]
    return typeof v === 'string' ? v : ''
  }

  const formId = get(k.id)
  if (!formId) return { ok: false, code: 'envelope.missing', detail: k.id }
  if (formId !== d.id) return { ok: false, code: 'envelope.form-mismatch', detail: formId }

  const revRaw = get(k.rev)
  const revision = Number(revRaw)
  // Ревизия — ПОЖЕЛАНИЕ: истина берётся из описания на сервере.
  if (!revRaw || !Number.isInteger(revision) || revision < 1)
    return { ok: false, code: 'envelope.invalid', detail: k.rev }

  const instance = get(k.instance)
  if (!INSTANCE_RE.test(instance)) return { ok: false, code: 'envelope.invalid', detail: k.instance }
  if (expect.instance && expect.instance !== instance)
    return { ok: false, code: 'envelope.instance-mismatch', detail: instance }

  const submissionId = get(k.submission)
  // идентификатор обязателен: иначе исход нечем различать
  if (!UUID_RE.test(submissionId)) return { ok: false, code: 'envelope.invalid', detail: k.submission }

  const raw = get(k.intent) || 'submit'
  const { action } = d.policy.intent.parse(raw)
  if (!d.actions.some((a) => a.id === action))
    return { ok: false, code: 'envelope.unknown-intent', detail: raw }

  const specRaw = get(k.spec)
  return {
    ok: true,
    envelope: {
      formId, revision, instance, submissionId, intent: raw,
      specVersion: specRaw ? Number(specRaw) : undefined,
    },
  }
}
