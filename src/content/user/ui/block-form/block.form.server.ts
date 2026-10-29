// Серверный POST-обработчик компонента `BlockForm` (`create` и `edit`).
// Полевые и модельные права (`moderator` vs `block.edit` vs `admin`,
// запрет правки `scope`, запрет блокировки самого себя и read-only режим)
// при отправке перепроверяет `auth(event).saveBlock(...)`.
import { localPath } from '#lib/address/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { blockForm } from './form.js'

registerComponentForm({
  description: blockForm,
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'save' && intent !== 'lift') {
      return fail(instruction({ code: 'auth.confirm' }))
    }

    const blockId = String(values.block_id ?? '').trim() || null
    const targetId = String(values.subject ?? '').trim() || null
    const forever = Boolean(values.forever)

    let until: number | null = null
    if (intent === 'save' && !forever) {
      const rawUntil = String(values.until ?? '').trim()
      if (!rawUntil) return fail(instruction({ code: 'auth.confirm' }))
      const parsed = Date.parse(rawUntil)
      if (!Number.isFinite(parsed)) return fail(instruction({ code: 'auth.confirm' }))
      until = parsed
    }

    const r = await u.saveBlock({
      blockId,
      targetId,
      scope: String(values.scope ?? ''),
      reason: String(values.reason ?? ''),
      forever,
      until,
      liftNow: intent === 'lift',
    })
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    return {
      data: {
        step: 'done',
        id: r.value.id,
        targetId: r.value.targetId,
      },
    }
  },
  redirectOnSuccess: (event) => {
    const next = localPath(event.url.searchParams.get('next'))
    if (next) return next
    const uidMatch = /^\/user\/([0-9a-f-]{36})\/blocks(?:\/|$)/i.exec(event.url.pathname)
    return uidMatch ? `/user/${uidMatch[1]}/blocks` : '/blocks'
  },
})
