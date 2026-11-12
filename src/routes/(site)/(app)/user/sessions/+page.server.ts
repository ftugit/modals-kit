// Свои устройства (`/user/sessions`) — тот же `load`, что у модалки
// `user.sessions`. Одна дверь данных: страница, модалка и догрузка порций идут
// сюда. Адресные ключи — `sessions.*` (адаптер пагинатора объявил их в
// `ui/sessions-list/source.ts`); `load` читает те же имена и умолчания.
// Блокировка и переименование — именованные экшены. Тело разбирает `#lib/form`.
import { redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { sessionRevokeForm, sessionRevokeOthersForm } from '#content/user/sessions.form.js'
import type { SessionsRouteData, SessionsState } from '#content/user/index.js'
import {
  SESSIONS_PAGE_PARAM,
  SESSIONS_PAGE_SIZE,
  SESSIONS_STATES,
  sessionsCountryCodes,
  sessionsSnapshot,
} from '#content/user/ui/sessions-list/source.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

const failed = '/user/sessions?notice=revoke-failed'
const list = '/user/sessions'
const throttle = createIpThrottle('user-sessions-revoke', 30, 60_000)

const error = (code: string, message: string, path?: string): FormError => ({
  id: `${path ?? '*'}:${code}:0`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

const num = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback
}

const dateMs = (raw: string | null): number | null => {
  if (!raw) return null
  const v = Date.parse(raw)
  return Number.isFinite(v) ? v : null
}

export const load: PageServerLoad = async (event): Promise<SessionsRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const notice = event.url.searchParams.get('notice') === 'revoke-failed' ? 'revoke-failed' : null
  const u = auth(event)
  if (!u.enabled) {
    return {
      snapshot: null,
      fact: 'auth.disabled',
      enabled: false,
      countries: [],
      notice,
      canSeeDeleted: false,
      canRename: false,
      canRevoke: false,
      canHardDelete: false,
    }
  }

  const sp = event.url.searchParams
  const key = (k: string) => sp.get(`${SESSIONS_PAGE_PARAM}.${k}`)
  const page = num(sp.get(SESSIONS_PAGE_PARAM), 1, 1, 100_000)
  const pageSize = num(key('size'), SESSIONS_PAGE_SIZE, 30, 100)
  const stateRaw = key('state')
  const state = SESSIONS_STATES.includes(stateRaw as SessionsState) ? (stateRaw as SessionsState) : undefined
  const country = sessionsCountryCodes(key('country'))
  const net = key('net') === '1' || key('net') === 'on'
  const cfrom = key('cfrom')
  const cto = key('cto')
  const sfrom = key('sfrom')
  const sto = key('sto')
  const createdFrom = dateMs(cfrom)
  const createdTo = dateMs(cto)
  const seenFrom = dateMs(sfrom)
  const seenTo = dateMs(sto)

  const r = await u.listSessionsPage({
    page,
    pageSize,
    state,
    country,
    subnetChanged: net,
    createdFrom,
    createdTo,
    seenFrom,
    seenTo,
  })
  if (!r.ok) {
    return {
      snapshot: null,
      fact: r.fact.code,
      enabled: true,
      countries: [],
      notice,
      canSeeDeleted: false,
      canRename: false,
      canRevoke: false,
      canHardDelete: false,
    }
  }

  return {
    // Срез в снапшоте — тот, который домен реально применил (права могли
    // срезать «отозванные»), поэтому состояние берётся из ответа, а не из адреса.
    snapshot: sessionsSnapshot(r.value, {
      state: r.value.state,
      net,
      country: country.join(','),
      cfrom: createdFrom !== null ? cfrom : null,
      cto: createdTo !== null ? cto : null,
      sfrom: seenFrom !== null ? sfrom : null,
      sto: seenTo !== null ? sto : null,
    }),
    fact: null,
    enabled: true,
    countries: r.value.countries,
    notice,
    canSeeDeleted: r.value.canSeeDeleted,
    canRename: r.value.canRename,
    canRevoke: r.value.canRevoke,
    canHardDelete: r.value.canHardDelete,
  }
}

export const actions: Actions = {
  revoke: async (event) => {
    const handled = await createFormHandler({
      description: sessionRevokeForm(''),
      order: SECURITY_LAYERS,
      throttle,
      async execute({ values, commit, fail }) {
        const id = String(values.id ?? '').trim()
        const r = await auth(event).revokeSessionById(id)
        if (!r.ok) return fail([error('auth.revoke', 'Не удалось заблокировать сессию', 'id')])
        commit()
        return { redirect: r.value.current ? '/user/auth' : list }
      },
    })(event.request, 'action', event)
    redirect(303, handled.result.ok && handled.result.redirect?.startsWith('/') ? handled.result.redirect : failed)
  },
  others: async (event) => {
    const handled = await createFormHandler({
      description: sessionRevokeOthersForm(),
      order: SECURITY_LAYERS,
      throttle,
      async execute({ commit, fail }) {
        const r = await auth(event).revokeBulkSessions({ scope: 'others' })
        if (!r.ok) return fail([error('auth.revoke', 'Не удалось заблокировать остальные сессии')])
        commit()
        return { redirect: r.value.current ? '/user/auth' : list }
      },
    })(event.request, 'action', event)
    redirect(303, handled.result.ok && handled.result.redirect?.startsWith('/') ? handled.result.redirect : failed)
  },
}
