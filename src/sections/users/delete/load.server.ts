// Удаление аккаунтов набором (`/users/delete`) — страница-fallback модалки
// `user.accounts.delete`: без JS сюда уходит обычный POST компонентной формы.
//
// Набор — либо явные `id`/`ids`, либо срез списка. Срез берётся из адреса
// носителя (`?del.list=/users?users.state=…`): список передаёт свой адрес целиком,
// а число строк считает сервер тем же правом, что список (§5.2). Клиент число
// не выдумывает и набор не усекает.
import type { RequestEvent } from '@sveltejs/kit'
import { localPath } from '#core/lib/address/index.js'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { BULK_IDS_LIMIT } from '#modules/user/base/service/bulk.js'
import { createUserConfig } from '#modules/user/base/index.js'
import type { AccountsDeleteRouteData } from '#modules/user/base/model/types.js'
import {
  ACCOUNTS_SLICE_KEYS,
  accountsSliceFrom,
  accountsSliceReader,
  hasSliceFields,
} from '#modules/user/accounts/svelte/accounts-delete/form.js'
import { localStore } from '#core/server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export async function loadUsersDelete(event: RequestEvent): Promise<AccountsDeleteRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const list = localPath(sp.get('del.list'))
  const source = list ? new URL(list, event.url).searchParams : sp
  const read = accountsSliceReader(source)
  const sliceFields = Object.fromEntries(
    ACCOUNTS_SLICE_KEYS.map((k) => [k, read(k) ?? '']).filter(([, v]) => String(v).trim() !== ''),
  )
  const slice = hasSliceFields((k) => sliceFields[k])

  const ids = [
    ...new Set(
      [sp.get('del.id'), ...(sp.get('del.ids') ?? '').split(',')]
        .map((s) => String(s ?? '').trim())
        .filter(Boolean),
    ),
  ]
  // Формы не смешиваются: срез отменяет явный набор.
  const idsForm = slice ? [] : ids

  const u = auth(event)
  const actor = await u.actor()
  const canDelete =
    actor.ok && actor.value.permissions.some((p) => p === 'admin' || p === 'server')

  let count: number | null = null
  if (slice && u.enabled && canDelete) {
    const r = await u.resolveAccountSlice(accountsSliceFrom(read))
    count = r.ok ? r.value.length : null
  }

  return {
    enabled: u.enabled,
    canDelete,
    ids: idsForm,
    tooMany: idsForm.length > BULK_IDS_LIMIT || (count !== null && count > BULK_IDS_LIMIT),
    sliceFields: slice ? sliceFields : null,
    count,
    holdSeconds: await config.get('holdSeconds'),
    fact: u.enabled ? null : 'auth.disabled',
  }
}
