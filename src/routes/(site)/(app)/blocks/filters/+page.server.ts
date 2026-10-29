// Страница фильтров списка блокировок (`/blocks/filters`) — fallback модалки
// `user.blocks.filters` для no-JS и источник данных загрузчика самой модалки.
import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'
import { auth } from '#content/user/gateway.server.js'
import { BLOCK_SCOPES, type AuthErrorCode } from '#content/user/index.js'
import { parseBlocksScopesFromSearch } from '#content/user/ui/blocks-list/source.js'

export interface BlocksFiltersPageData {
  uid: string | null
  canSeeDeleted: boolean
  canSeeLive: boolean
  canPickUsers: boolean
  fact: AuthErrorCode | null
  enabled: boolean
  values: {
    ord: string
    state: string
    scopes: string[]
    uids: string[]
    size: number
  }
  selfHref: string
  action: string
  hiddenFields: { name: string; value: string }[]
  resetHref: string
  backHref: string
}

const FILTER_KEYS = new Set([
  'blocks.ord',
  'blocks.state',
  'blocks.scopes',
  'blocks.uids',
  'blocks.size',
  ...Object.keys(BLOCK_SCOPES).map((k) => `blocks.sc.${k}`),
])

export const load: PageServerLoad = async (event): Promise<BlocksFiltersPageData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const uidParam = sp.get('uid')?.trim() || null
  const defaultBack = uidParam ? `/user/${encodeURIComponent(uidParam)}/blocks` : '/blocks'
  const from = localPath(sp.get('from')) ?? defaultBack
  const fromUrl = new URL(from, 'http://local.invalid')
  const fromSp = fromUrl.searchParams

  // Если `uid` не передан явно в query, извлекаем из `/user/<uuid>/blocks` в `from`
  const uidMatch = /^\/user\/([0-9a-f-]{36})\/blocks(?:\/|$)/i.exec(fromUrl.pathname)
  const uid = uidParam ?? (uidMatch ? uidMatch[1]! : null)

  const val = (k: string) => sp.get(k) ?? fromSp.get(k) ?? ''
  const sizeRaw = Number(val('blocks.size'))

  const scopesOwn = parseBlocksScopesFromSearch(sp)
  const scopesFrom = parseBlocksScopesFromSearch(fromSp)
  const scopes = scopesOwn.length ? scopesOwn : scopesFrom

  const uidsRaw = sp.get('blocks.uids') ?? fromSp.get('blocks.uids') ?? ''
  const uids = uid
    ? []
    : uidsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 500)

  const values = {
    ord: val('blocks.ord') || 'created-desc',
    state: val('blocks.state') || 'all',
    scopes,
    uids,
    size: Number.isFinite(sizeRaw) ? Math.min(100, Math.max(30, Math.trunc(sizeRaw))) : 30,
  }

  const hiddenFields: { name: string; value: string }[] = []
  for (const [k, v] of fromSp.entries()) {
    if (FILTER_KEYS.has(k) || k === 'blocks' || k === 'from' || k === 'uid') continue
    hiddenFields.push({ name: k, value: v })
  }
  const rest = new URLSearchParams(hiddenFields.map((h) => [h.name, h.value] as [string, string]))
  const resetHref = rest.size ? `${fromUrl.pathname}?${rest}` : fromUrl.pathname

  const u = auth(event)
  const r = await u.listBlocksPage({ uid, page: 1, pageSize: 1 })

  const selfQs = event.url.searchParams.toString()
  const selfHref = selfQs ? `${event.url.pathname}?${selfQs}` : event.url.pathname

  return {
    uid,
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
    canSeeLive: r.ok ? r.value.canSeeLive : false,
    canPickUsers: r.ok ? r.value.canPickUsers : false,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    values,
    selfHref,
    action: fromUrl.pathname,
    hiddenFields,
    resetHref,
    backHref: from,
  }
}
