import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import {
  PROFILES_PAGE_PARAM,
  PROFILES_PAGE_SIZE,
  PROFILES_PAGE_SIZES,
  profilesSnapshot,
  type ProfilesRouteData,
} from '#content/user/ui/profiles/source.js'

const num = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback
}

/** Значение размера страницы — только из объявленного набора; иначе ближайший меньший. */
const pageSizeOf = (raw: string | null): number => {
  const v = Number(raw)
  return PROFILES_PAGE_SIZES.filter((size) => size <= v).at(-1) ?? PROFILES_PAGE_SIZE
}

export const load: PageServerLoad = async (event): Promise<ProfilesRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const sp = event.url.searchParams
  const key = (k: string) => sp.get(`${PROFILES_PAGE_PARAM}.${k}`)

  const page = num(sp.get(PROFILES_PAGE_PARAM), 1, 1, 10_000)
  const pageSize = pageSizeOf(key('size'))
  const q = key('q')

  const u = auth(event)
  const r = await u.listProfiles({ page, pageSize, search: q ?? undefined })

  return {
    snapshot: r.ok
      ? profilesSnapshot(r.value, { q: q || null })
      : null,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
  }
}