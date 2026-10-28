// Серверный POST-обработчик компонента `ProfileDelete`: намерение из формы,
// права и запреты цели перепроверяет домен (`deleteProfile`) в момент
// отправки — показ кнопки удаление не разрешает.
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { userProfileRoute } from '../../routes.js'
import { profileDeleteForm } from './form.js'

registerComponentForm({
  description: profileDeleteForm,
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'delete') return fail(instruction({ code: 'auth.confirm' }))
    const subject = String(values.subject ?? '').trim() || undefined
    const r = await u.deleteProfile({ withSeed: Boolean(values.with_seed) }, subject)
    if (!r.ok) return fail(instruction(r.fact))
    commit()
    return { data: { step: 'done' } }
  },
  redirectOnSuccess: (event) => {
    const parsed = userProfileRoute.parse(event.url)
    return parsed.next ?? (parsed.id ? `/user/${parsed.id}` : '/')
  },
})
