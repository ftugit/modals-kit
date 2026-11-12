// Страница фильтров списка устройств — fallback модалки
// `user.sessions.filters` для no-JS. Кнопка над списком без JS ведёт сюда;
// форма уходит POST на эту же страницу, сервер отвечает 303 на адрес списка,
// собранный адаптером.
//
// Адрес носителя приходит параметром `from` и проверяется `localPath`. Оттуда
// же берутся текущие значения фильтров. Чужие ключи адреса сохраняет адаптер
// при сборке 303, не скрытые поля GET.
import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'
import { auth } from '#content/user/gateway.server.js'
import type { AuthErrorCode } from '#content/user/index.js'
import type { SessionsFilterValues } from '#content/user/ui/SessionsFiltersForm.svelte'
import { sessionsCountryCodes } from '#content/user/ui/sessions-list/source.js'

export interface SessionsFiltersPageData {
  canSeeDeleted: boolean
  countries: readonly string[]
  fact: AuthErrorCode | null
  enabled: boolean
  values: SessionsFilterValues
  /** Адрес носителя без фильтров — «Сбросить». */
  resetHref: string
  /** Адрес носителя как был — «К списку» и скрытое `from` формы. */
  backHref: string
}

const FILTER_KEYS = [
  'sessions.state',
  'sessions.net',
  'sessions.country',
  'sessions.cfrom',
  'sessions.cto',
  'sessions.sfrom',
  'sessions.sto',
  'sessions.size',
]

export const load: PageServerLoad = async (event): Promise<SessionsFiltersPageData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const from = localPath(sp.get('from')) ?? '/user/sessions'
  const fromUrl = new URL(from, 'http://local.invalid')
  const fromSp = fromUrl.searchParams

  const val = (k: string) => sp.get(k) ?? fromSp.get(k) ?? ''
  // Размер порции — поле формы (30..100), а не чужое состояние.
  const sizeRaw = Number(val('sessions.size'))
  const values: SessionsFilterValues = {
    state: val('sessions.state') || 'active',
    net: val('sessions.net') === '1' || val('sessions.net') === 'on',
    country: sessionsCountryCodes(val('sessions.country')),
    cfrom: val('sessions.cfrom'),
    cto: val('sessions.cto'),
    sfrom: val('sessions.sfrom'),
    sto: val('sessions.sto'),
    size: Number.isFinite(sizeRaw) ? Math.min(100, Math.max(30, Math.trunc(sizeRaw))) : 30,
  }

  // Пронести всё, кроме самих фильтров и указателя порции (новый срез — сначала).
  const hiddenFields: { name: string; value: string }[] = []
  for (const [k, v] of fromSp.entries()) {
    if (FILTER_KEYS.includes(k) || k === 'sessions') continue
    hiddenFields.push({ name: k, value: v })
  }
  const rest = new URLSearchParams(hiddenFields.map((h) => [h.name, h.value] as [string, string]))
  const resetHref = rest.size ? `${fromUrl.pathname}?${rest}` : fromUrl.pathname

  // Срез стран — того же аккаунта, что и список: цель берём из `uid`, если он
  // передан явно, иначе из пути носителя `/user/<uuid>/sessions` (как у фильтров
  // блокировок). Отдельного query-ключа списка нет.
  const uidParam = sp.get('uid')?.trim() || fromSp.get('uid')?.trim() || null
  const uidMatch = /^\/user\/([0-9a-f-]{36})\/sessions(?:\/|$)/i.exec(fromUrl.pathname)
  const uid = uidParam ?? (uidMatch ? uidMatch[1]!.toLowerCase() : null)
  const u = auth(event)
  const r = await u.listSessionsPage({ authId: uid, page: 1, pageSize: 1 })

  return {
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
    countries: r.ok ? r.value.countries : [],
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    values,
    resetHref,
    backHref: from,
  }
}
