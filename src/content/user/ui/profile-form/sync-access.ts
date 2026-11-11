// После WS-загрузки профиль уже сохранён, но cookie нельзя обновить по WebSocket.
// Авторизованный HTTP POST устанавливает HttpOnly access и возвращает только метаданные.
import { buildEnvelope } from '#lib/form/index.js'
import { kitActionTransport } from '#hooks/component-form/transport.js'
import type { VaultPayload } from '../../vault.svelte.js'
import { profileForm } from './form.js'

export async function syncProfileAccess(path: string, expectedSub: string, signal: AbortSignal): Promise<VaultPayload | null> {
  const envelope = {
    formId: profileForm.id,
    revision: profileForm.revision,
    instance: `${profileForm.id}:${crypto.randomUUID()}`,
    submissionId: crypto.randomUUID(),
    intent: 'sync-access',
  }
  const data = new FormData()
  for (const [name, value] of Object.entries(buildEnvelope(envelope))) data.append(name, value)
  data.append('intent', envelope.intent)
  const out = await kitActionTransport(path)({ envelope, data, accept: ['application/json'], signal })
  if (out.kind !== 'result' || !out.result.ok) return null
  const user = (out.result.data as { user?: VaultPayload } | undefined)?.user
  return user?.sub === expectedSub ? user : null
}
