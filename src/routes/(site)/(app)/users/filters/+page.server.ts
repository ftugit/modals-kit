// Страница фильтров списка seed-юзеров — fallback модалки `user.list.filters`
// для no-JS. Кнопка над списком без JS ведёт сюда. Форма уходит POST на эту
// же страницу; сервер отвечает 303 на адрес списка, собранный адаптером.
//
// Адрес носителя приходит параметром `from` и проверяется `localPath`.
// Оттуда же берутся текущие значения фильтров. Чужие ключи адреса сохраняет
// адаптер при сборке 303, не скрытые поля GET.
import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'
import { auth } from '#content/user/gateway.server.js'
import type { AuthErrorCode } from '#content/user/index.js'

export interface SeedUsersFiltersPageData {
  canSeeDeleted: boolean
  canSeeNickname: boolean
  fact: AuthErrorCode | null
  enabled: boolean
  /** Значения формы из адреса списка (`from`) и query этой страницы. */
  values: { ord: string; state: string; cfrom: string; cto: string; dfrom: string; dto: string; nick: boolean; size: number }
  /** Адрес носителя без фильтров — «Сбросить». */
  resetHref: string
  /** Адрес носителя как был — «К списку» и скрытое `from` формы. */
  backHref: string
}

const FILTER_KEYS = [
  'users.ord',
  'users.state',
  'users.cfrom',
  'users.cto',
  'users.dfrom',
  'users.dto',
  'users.nick',
  'users.size',
]

export const load: PageServerLoad = async (event): Promise<SeedUsersFiltersPageData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const from = localPath(sp.get('from')) ?? '/users'
  const fromUrl = new URL(from, 'http://local.invalid')
  const fromSp = fromUrl.searchParams

  const val = (k: string) => sp.get(k) ?? fromSp.get(k) ?? ''
  // Размер порции — поле формы (30..100), а не чужое состояние: из скрытых
  // полей он исключён списком FILTER_KEYS выше и в resetHref не попадает.
  const sizeRaw = Number(val('users.size'))
  const values = {
    ord: val('users.ord') || 'created-desc',
    state: val('users.state') || 'active',
    cfrom: val('users.cfrom'),
    cto: val('users.cto'),
    dfrom: val('users.dfrom'),
    dto: val('users.dto'),
    // Чекбокс: '1' — адрес модального пути, 'on' — нативная посылка формы.
    nick: val('users.nick') === '1' || val('users.nick') === 'on',
    size: Number.isFinite(sizeRaw) ? Math.min(100, Math.max(30, Math.trunc(sizeRaw))) : 30,
  }
  // Порядок по никнейму без включённого параметра недостижим: умолчание
  // (тот же сброс, что `Option.when` на клиенте и coercion домена).
  if (!values.nick && values.ord.startsWith('nickname')) values.ord = 'created-desc'

  // Пронести всё, кроме самих фильтров и указателя порции (новый срез — сначала).
  const hiddenFields: { name: string; value: string }[] = []
  for (const [k, v] of fromSp.entries()) {
    if (FILTER_KEYS.includes(k) || k === 'users') continue
    hiddenFields.push({ name: k, value: v })
  }
  const rest = new URLSearchParams(hiddenFields.map((h) => [h.name, h.value] as [string, string]))
  const resetHref = rest.size ? `${fromUrl.pathname}?${rest}` : fromUrl.pathname

  const u = auth(event)
  const r = await u.listSeedUsers({ page: 1, pageSize: 1 })

  return {
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
    canSeeNickname: r.ok ? r.value.canSeeNickname : false,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    values,
    resetHref,
    backHref: from,
  }
}
