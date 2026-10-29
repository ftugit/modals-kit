import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '../../gateway.server.js'
import type { BlocksOrder, BlocksState } from '../../types.js'
import {
  BLOCKS_ORDERS,
  BLOCKS_PAGE_PARAM,
  BLOCKS_PAGE_SIZE,
  BLOCKS_STATES,
  blocksSnapshot,
  parseBlocksScopesFromSearch,
  type BlocksRouteData,
} from './source.js'

const num = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback
}

export async function loadBlocksRouteData(
  event: RequestEvent,
  fixedUid: string | null,
): Promise<BlocksRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const key = (k: string) => sp.get(`${BLOCKS_PAGE_PARAM}.${k}`)

  const page = num(sp.get(BLOCKS_PAGE_PARAM), 1, 1, 10_000)
  const pageSize = num(key('size'), BLOCKS_PAGE_SIZE, 30, 100)
  const ordRaw = key('ord')
  const stateRaw = key('state')
  const scopes = parseBlocksScopesFromSearch(sp)
  const uids = fixedUid
    ? []
    : (key('uids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 500)

  const order = BLOCKS_ORDERS.includes(ordRaw as BlocksOrder)
    ? (ordRaw as BlocksOrder)
    : undefined
  const state = BLOCKS_STATES.includes(stateRaw as BlocksState)
    ? (stateRaw as BlocksState)
    : undefined

  const u = auth(event)
  const r = await u.listBlocksPage({
    uid: fixedUid,
    uids,
    scopes,
    state,
    order,
    page,
    pageSize,
  })

  return {
    snapshot: r.ok
      ? blocksSnapshot(r.value, {
          ord: order,
          state,
          scopes: scopes.join(','),
          uids: uids.join(','),
        })
      : null,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    uid: fixedUid,
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
    canSeeLive: r.ok ? r.value.canSeeLive : false,
    canPickUsers: r.ok ? r.value.canPickUsers : false,
    canCreate: r.ok ? r.value.canCreate : false,
    assignableScopes: r.ok ? r.value.assignableScopes : [],
  }
}
