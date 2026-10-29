// Страница выбора пользователей (`/users/pick`) — fallback модалки `user.picker`
// для no-JS и прямых переходов. Принимает `from` (куда вернуться), `param`
// (какой query-параметр в `from` заполнить выбранными UUID), `mode`
// (`single` | `multiple`) и `picked` (стартовый набор UUID).
import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'
import { auth } from '#content/user/gateway.server.js'
import type { AuthErrorCode } from '#content/user/index.js'

export interface UserPickerPageData {
  mode: 'single' | 'multiple'
  picked: string[]
  fromHref: string
  targetParam: string
  fact: AuthErrorCode | null
  enabled: boolean
}

export const load: PageServerLoad = async (event): Promise<UserPickerPageData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const fromHref = localPath(sp.get('from')) ?? '/blocks'
  const mode = sp.get('mode') === 'single' ? 'single' : 'multiple'
  const rawParam = (sp.get('param') ?? 'blocks.uids').trim()
  const targetParam = /^[a-z0-9._-]{1,40}$/i.test(rawParam) ? rawParam : 'blocks.uids'
  const picked = (sp.get('picked') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500)

  const u = auth(event)
  const r = await u.listSeedUsers({ page: 1, pageSize: 1 })

  return {
    mode,
    picked: mode === 'single' ? picked.slice(0, 1) : picked,
    fromHref,
    targetParam,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
  }
}
