// Серверный POST-обработчик компонента `ProfilePrivacy` (`#hooks/component-form`).
// Запись — конфиг-API через фасад (`setProfileVisibility`): право владельца
// держит схема ключа в модели, значение = умолчание строку юзера не плодит.
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { privacyForm } from './form.js'

registerComponentForm({
  description: privacyForm,
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'privacy') return fail(instruction({ code: 'auth.confirm' }))

    const r = await u.setProfileVisibility(String(values.level ?? ''))
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    return { data: { step: 'done' } }
  },
})
