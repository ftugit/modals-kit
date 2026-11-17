// Регистрация модалок блокировок. Подхватывается glob'ом `modules/**/modals.ts`.
import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import {
  blocksBulkRoute,
  blocksCreateRoute,
  blocksDeleteRoute,
  blocksEditRoute,
  blocksFiltersRoute,
  blocksListRoute,
  userBlocksCreateRoute,
  userBlocksDeleteRoute,
  userBlocksEditRoute,
  userBlocksRoute,
} from '#modules/user/base/routes.js'

registerModal({
  name: 'user.blocks',
  component: lazy(() => import('#modules/user/blocks/svelte/BlocksModal.svelte')),
  route: (p: { id?: string }) =>
    p?.id ? userBlocksRoute.href({ id: String(p.id) }) : blocksListRoute.href(),
  size: { width: 680, height: 560 },
})
registerModal({
  name: 'user.blocks.filters',
  component: lazy(() => import('#modules/user/blocks/svelte/BlocksFiltersModal.svelte')),
  defaultParams: { uids: '' },
  route: (p: { uid?: string; uids?: string }) => blocksFiltersRoute.href({ uid: p?.uid ?? null }),
  size: { width: 460, height: 580 },
})
registerModal({
  name: 'user.blocks.create',
  component: lazy(() => import('#modules/user/blocks/svelte/BlockCreateModal.svelte')),
  defaultParams: { uids: '' },
  route: (p: { uid?: string; uids?: string; list?: string }) => {
    if (p?.uid) return userBlocksCreateRoute.href({ id: String(p.uid) })
    const uids = p?.uids ? String(p.uids).trim() : ''
    return blocksCreateRoute.href({
      uids: uids || null,
      'blk.list': p?.list ? String(p.list) : null,
    })
  },
  size: { width: 480, height: 560 },
})
registerModal({
  name: 'user.blocks.edit',
  component: lazy(() => import('#modules/user/blocks/svelte/BlockEditModal.svelte')),
  route: (p: { blockId: string; uid?: string }) => {
    const blockId = String(p?.blockId ?? '').trim()
    if (!blockId) throw new Error('[modals] blockId is required')
    return p?.uid
      ? userBlocksEditRoute.href({ id: String(p.uid), blockId })
      : blocksEditRoute.href({ blockId })
  },
  size: { width: 480, height: 580 },
})
registerModal({
  name: 'user.blocks.delete',
  component: lazy(() => import('#modules/user/blocks/svelte/BlockDeleteModal.svelte')),
  route: (p: { blockId: string; uid?: string }) => {
    const blockId = String(p?.blockId ?? '').trim()
    if (!blockId) throw new Error('[modals] blockId is required')
    return p?.uid
      ? userBlocksDeleteRoute.href({ id: String(p.uid), blockId })
      : blocksDeleteRoute.href({ blockId })
  },
  size: { width: 460, height: 440 },
})
registerModal({
  name: 'user.blocks.bulk',
  component: lazy(() => import('#modules/user/blocks/svelte/BlocksBulkModal.svelte')),
  defaultParams: { ids: '', list: '' },
  route: (p: { ids?: string; list?: string }) =>
    blocksBulkRoute.href({
      'bb.ids': p?.ids ? String(p.ids) : null,
      'bb.list': p?.list ? String(p.list) : null,
    }),
  size: { width: 480, height: 480 },
})
