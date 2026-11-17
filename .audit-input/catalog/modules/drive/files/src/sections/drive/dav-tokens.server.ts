/**
 * Пароли приложений WebDAV в настройках (`plan-drive-ui.md` §9).
 *
 * Экран живёт отдельной SSR-страницей `/user/config/dav`: список и отзыв —
 * обычные POST-формы, выдача показывает открытый пароль ровно один раз.
 * Секрет не кладётся в адрес: после выдачи он лежит в `sharedStore` под
 * случайным id, а загрузчик забирает и удаляет его при первом рендере.
 */
import type { Actions, RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { AUTH_SEAL_SECRET } from '$app/env/private'
import { localPath } from '#core/lib/address/index.js'
import { createFormHandler } from '#core/lib/form/server.js'
import { sharedStore } from '#core/server/cache.server.js'
import { db } from '#core/server/db.server.js'
import { createIpThrottle } from '#core/server/client-ip.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'
import { DRIVE_MESSAGES } from '#modules/drive/messages.js'
import { driveDavIssueForm, driveDavRevokeForm } from '#modules/drive/form.js'
import { issueDriveDavToken, listDriveDavTokens, revokeDriveDavToken } from '#modules/drive/service/tokens.js'
import type { DriveActor, DriveDavTokensData } from '#modules/drive/types.js'
import { auth } from '#modules/user/base/service/gateway.server.js'

const ISSUED_TTL_MS = 10 * 60_000
const issuedStore = sharedStore.scope('drive-dav-issued', { max: 1000 })
const throttle = createIpThrottle('drive-dav-tokens', 30, 60_000)

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const backHref = (event: RequestEvent, values: Record<string, unknown>): string =>
  localPath(text(values.return_to)) ?? '/user/config/dav'

const noticeHref = (path: string, code: string): string => {
  const url = new URL(path, 'http://local')
  if (code in DRIVE_MESSAGES) url.searchParams.set('notice', code)
  const query = url.searchParams.toString()
  return query ? `${url.pathname}?${query}` : url.pathname
}

async function actorOf(event: RequestEvent): Promise<DriveActor | null> {
  const u = auth(event)
  if (!u.enabled) return null
  const who = await u.actor()
  if (!who.ok) return null
  return { id: who.value.id, permissions: [...(who.value.permissions ?? [])] }
}

/** Список и одноразовый секрет. Секрет удаляется из хранилища при чтении. */
export async function loadDavTokens(event: RequestEvent): Promise<DriveDavTokensData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const enabled = Boolean(AUTH_SEAL_SECRET && AUTH_SEAL_SECRET.length >= 32)
  const denied = (): DriveDavTokensData => ({
    enabled,
    tokens: [],
    issued: null,
    fact: 'auth.forbidden',
    notice: null,
  })
  const actor = await actorOf(event)
  if (!actor) return denied()
  const list = await listDriveDavTokens(db, actor)
  if (!list.ok) return denied()
  const issuedId = event.url.searchParams.get('issued')
  const issued = issuedId ? await issuedStore.get<string>(issuedId) : undefined
  if (issuedId) await issuedStore.delete(issuedId)
  const noticeParam = event.url.searchParams.get('notice')
  return {
    enabled,
    tokens: list.value,
    issued: issued ?? null,
    fact: null,
    notice: noticeParam && noticeParam in DRIVE_MESSAGES ? noticeParam : null,
  }
}

async function run(
  event: RequestEvent,
  description: Parameters<typeof createFormHandler>[0]['description'],
  op: (actor: DriveActor, values: Record<string, unknown>) => Promise<{ ok: true; redirect: string } | { ok: false; code: string }>,
) {
  const handled = await createFormHandler({
    description,
    order: SECURITY_LAYERS,
    throttle,
    async execute({ values, commit }) {
      const actor = await actorOf(event)
      if (!actor) {
        commit()
        return { redirect: noticeHref('/user/config/dav', 'auth.forbidden') }
      }
      const result = await op(actor, values as Record<string, unknown>)
      commit()
      return result.ok
        ? { redirect: result.redirect }
        : { redirect: noticeHref(backHref(event, values), result.code) }
    },
  })(event.request, 'action', event)
  if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
  return fail(handled.status, { result: handled.result })
}

export const davTokenActions = {
  issue: (event) =>
    run(event, driveDavIssueForm(''), async (actor, values) => {
      const result = await issueDriveDavToken(db, actor, {
        label: text(values.label),
        secretKey: AUTH_SEAL_SECRET ?? '',
      })
      if (!result.ok) return { ok: false as const, code: result.code }
      const id = crypto.randomUUID()
      await issuedStore.set(id, result.value.token, ISSUED_TTL_MS)
      return { ok: true as const, redirect: `/user/config/dav?issued=${encodeURIComponent(id)}` }
    }),
  revoke: (event) =>
    run(event, driveDavRevokeForm('', ''), async (actor, values) => {
      const result = await revokeDriveDavToken(db, actor, text(values.token_id))
      return result.ok
        ? { ok: true as const, redirect: backHref(event, values) }
        : { ok: false as const, code: result.code }
    }),
} satisfies Actions
