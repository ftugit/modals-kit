// Наборные действия над блокировками (`/blocks/bulk`) — страница-fallback
// модалки `user.blocks.bulk`: без JS сюда уходит обычный POST компонентной формы.
//
// Набор — либо явные `bb.ids`, либо срез списка. Срез берётся из адреса
// носителя (`?bb.list=/blocks?blocks.state=active`): список передаёт свой адрес
// целиком, а число строк считает сервер тем же правом, что список (§5.2).
// Персональный список блокировок живёт на `/user/<id>/blocks`, поэтому uid
// приходит путём адреса-носителя, а не ключом строки запроса.
import { localPath } from '#lib/address/index.js'
import { auth } from '#content/user/gateway.server.js'
import { BULK_IDS_LIMIT } from '#content/user/bulk.js'
import { canEditBlockReason, canSoftDeleteBlock } from '#content/user/blocks.js'
import { createUserConfig } from '#content/user/index.js'
import type { BlocksBulkRouteData } from '#content/user/types.js'
import {
  BLOCKS_SLICE_KEYS,
  blocksSliceFrom,
  blocksSliceReader,
  hasSliceFields,
} from '#content/user/ui/blocks-bulk/form.js'
import { localStore } from '#server/cache.server.js'
import type { PageServerLoad } from './$types'

const config = createUserConfig(localStore.scope('user-config'))

const UUID_PATH = /^\/user\/([0-9a-f-]{36})\/blocks\/?$/i

export const load: PageServerLoad = async (event): Promise<BlocksBulkRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const list = localPath(sp.get('bb.list'))
  const listUrl = list ? new URL(list, event.url) : null
  const source = listUrl?.searchParams ?? sp
  const read = blocksSliceReader(source)

  const sliceFields = Object.fromEntries(
    BLOCKS_SLICE_KEYS.map((k) => [k, read(k) ?? '']).filter(([, v]) => String(v).trim() !== ''),
  )
  // Цель персонального списка: uid в пути носителя, в срезе — тем же именем.
  const uidMatch = listUrl ? UUID_PATH.exec(listUrl.pathname) : null
  if (uidMatch) sliceFields.uid = uidMatch[1]!.toLowerCase()
  const slice = hasSliceFields((k) => sliceFields[k])

  const ids = [
    ...new Set(
      String(sp.get('bb.ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
  // Формы не смешиваются: срез отменяет явный набор.
  const idsForm = slice ? [] : ids

  const u = auth(event)
  const actor = await u.actor()
  const perms = actor.ok ? actor.value.permissions : []
  const canLift = canEditBlockReason(perms)
  const canDelete = canSoftDeleteBlock(perms)

  let count: number | null = null
  if (slice && u.enabled && (canLift || canDelete)) {
    const r = await u.resolveBlockSlice(blocksSliceFrom((k) => sliceFields[k]))
    count = r.ok ? r.value.length : null
  }

  return {
    enabled: u.enabled,
    canLift,
    canDelete,
    ids: idsForm,
    tooMany: idsForm.length > BULK_IDS_LIMIT || (count !== null && count > BULK_IDS_LIMIT),
    sliceFields: slice ? sliceFields : null,
    count,
    holdSeconds: await config.get('holdSeconds'),
    fact: u.enabled ? null : 'auth.disabled',
  }
}
