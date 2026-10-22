// Лёгкий конверт для программных отправок без подтягивания описаний полей и
// фото-проверок (`forms.ts` → `photo.ts` → `probe.ts`) в фоновый чанк `vault`.
import { buildEnvelope, type Envelope } from '#lib/form/index.js'

export const SEED_FORM_ID = 'user-auth'
// ревизия 6: универсальная `seedForm` (вход, регистрация, восстановление + confirm)
export const SEED_FORM_REV = 6
export const PROFILE_FORM_ID = 'user-profile'

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
