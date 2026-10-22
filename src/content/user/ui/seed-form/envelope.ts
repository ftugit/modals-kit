// Лёгкий конверт для программных отправок без подтягивания описаний полей
// в фоновый чанк продления `vault`.
import { buildEnvelope, type Envelope } from '#lib/form/index.js'

export const SEED_FORM_ID = 'user-auth'
export const SEED_FORM_REV = 6

export function seedEnvelope(instance: string): Envelope {
  return {
    formId: SEED_FORM_ID,
    revision: SEED_FORM_REV,
    instance,
    submissionId: crypto.randomUUID(),
    intent: 'submit',
  }
}

export function seedEnvelopeFields(envelope: Envelope): Record<string, string> {
  const { intent: _intent, ...rest } = envelope
  return buildEnvelope(rest)
}
