/**
 * Один `load` и один набор экшенов на два адреса списка устройств:
 *
 *  - `/user/sessions` — свои устройства (`fixedUid = null`);
 *  - `/user/<uuid>/sessions` — устройства выбранного аккаунта (`fixedUid` из
 *    параметра пути).
 *
 * Почему так, а не `?uid=`: у остальных списков цель едет ПУТЁМ и попадает в
 * компонент отдельным пропом (`BlocksList uid={data.uid}` в
 * `/user/[id]/blocks`). Ключи адреса (`sessions.*`) остаются за фильтрами и
 * порцией, чужой query-ключ не заводится. Догрузка порций идёт по тому же
 * пути: uid лежит во внутреннем `extra` снапшота (`_uid`) и в URL не пишется.
 *
 * Модалка `user.sessions` зовёт `/user/sessions` без `fixedUid` — она всегда
 * про свои устройства.
 */
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '../../gateway.server.js'
import type { SessionsRouteData, SessionsState } from '../../types.js'
import {
  SESSIONS_PAGE_PARAM,
  SESSIONS_PAGE_SIZE,
  SESSIONS_STATES,
  sessionsCountryCodes,
  sessionsSnapshot,
} from './source.js'

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

/** Адрес списка этого аккаунта: свой — без цели, чужой — путём. */
export function sessionsListHref(uid: string | null): string {
  return uid ? `/user/${encodeURIComponent(uid)}/sessions` : '/user/sessions'
}

/**
 * Цель экшена — параметр пути (`/user/<uuid>/sessions`), а не поле формы:
 * подменяемый `uid` в теле запроса не должен решать, чьи устройства гасить.
 */
export function sessionsTargetOf(event: RequestEvent): string | null {
  const id = (event.params as { id?: string } | undefined)?.id?.trim()
  return id ? id.toLowerCase() : null
}

export async function loadSessionsRouteData(
  event: RequestEvent,
  fixedUid: string | null,
  /** Общий журнал (`/sessions`): без аккаунта, нужно право на чужие. */
  journal = false,
): Promise<SessionsRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const uid = journal ? null : fixedUid?.trim().toLowerCase() || null
  const notice = event.url.searchParams.get('notice') === 'revoke-failed' ? 'revoke-failed' : null
  const u = auth(event)
  if (!u.enabled) {
    return {
      snapshot: null,
      fact: 'auth.disabled',
      enabled: false,
      uid,
      journal,
      canReadOthers: false,
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
    authId: uid,
    journal,
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
      uid,
      journal,
      canReadOthers: false,
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
      uid,
      journal,
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
    uid,
    journal,
    canReadOthers: r.value.canReadOthers,
    countries: r.value.countries,
    notice,
    canSeeDeleted: r.value.canSeeDeleted,
    canRename: r.value.canRename,
    canRevoke: r.value.canRevoke,
    canHardDelete: r.value.canHardDelete,
  }
}
