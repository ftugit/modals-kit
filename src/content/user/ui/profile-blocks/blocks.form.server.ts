// Серверный POST-обработчик компонента `ProfileBlocks` (`#hooks/component-form`).
// Права круга, каталог сфер и содержательные правила держит модель
// (`user.block`: маски, политики, `checks`); домен добавляет факты.
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { blocksForm } from './form.js'

registerComponentForm({
  description: blocksForm,
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    const subject = String(values.subject ?? '').trim()
    if (!subject) return fail(instruction({ code: 'auth.identity-unknown' }))

    if (intent === 'lift') {
      const r = await u.liftBlock({ targetId: subject, blockId: String(values.block_id ?? '') })
      if (!r.ok) return fail(instruction(r.fact))
      commit()
      return { data: { step: 'done' } }
    }
    if (intent !== 'add') return fail(instruction({ code: 'auth.confirm' }))

    const forever = Boolean(values.forever)
    const untilRaw = String(values.until ?? '').trim()
    const until = forever ? null : untilRaw ? Date.parse(untilRaw) : null
    if (!forever && (until === null || Number.isNaN(until))) {
      return fail(instruction({ code: 'auth.confirm' }))
    }
    const r = await u.addBlock({
      targetId: subject,
      scope: String(values.scope ?? ''),
      reason: String(values.reason ?? ''),
      forever,
      until,
    })
    if (!r.ok) return fail(instruction(r.fact))
    commit()
    return { data: { step: 'done' } }
  },
})
