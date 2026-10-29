// Серверный POST-обработчик компонента `BlockDelete`.
// Мягкое удаление доступно кругу записи (`moderator`/`block.edit`/`admin`),
// полное (`hard: true`) — только при связке с `block.readDeleted` или `admin`.
import { localPath } from '#lib/address/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { blockDeleteForm } from './form.js'

registerComponentForm({
  description: blockDeleteForm,
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'delete') return fail(instruction({ code: 'auth.confirm' }))

    const blockId = String(values.block_id ?? '').trim()
    const targetId = String(values.subject ?? '').trim() || null
    const hard = Boolean(values.hard)

    const r = await u.deleteBlock({ blockId, targetId, hard })
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    return {
      data: {
        step: 'done',
        hard: r.value.hard,
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
