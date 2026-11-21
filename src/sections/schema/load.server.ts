// Section: перенос схемы базы (`/schema`) — load/actions вынесены из route.
import type { RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { localPath } from '#core/lib/address/index.js'
import type { Result } from '#core/lib/form/index.js'
import { handleSchemaResolve, handleSchemaUnlock, schemaScreen } from '#core/hooks/db-schema.server.js'
import { SCHEMA_UNLOCK_COOKIE } from '#core/hooks/db-schema.js'
import { schemaAdmin } from '#core/server/db.server.js'
import type { SchemaActionData } from './types.js'

/** Данные экшена при отказе: `Result` `#core/lib/form`, который подсаживается в форму. */
export type { SchemaActionData } from './types.js'

/** Куда вернуться после переноса; `null` — остаёмся на экране. */
const nextOf = (url: URL): string | null => localPath(url.searchParams.get('next'))

export async function loadSchema(event: RequestEvent) {
  const next = nextOf(event.url)
  // Отчёт — только за секретом: если токен не задан или не подошёл, схема
  // даже не читается (драйвер не открывается зря).
  if (!schemaAdmin.enabled) {
    return { locked: 'disabled' as const, screen: null, next, token: '' }
  }
  const token = event.cookies.get(SCHEMA_UNLOCK_COOKIE) ?? ''
  if (!(await schemaAdmin.verify(token))) {
    return { locked: 'token' as const, screen: null, next, token: '' }
  }
  return {
    locked: null,
    // Отчёт открывает ленивый драйвер мимо `gate`: при конфликте это единственный путь.
    screen: await schemaScreen(),
    next,
    token,
  }
}

export const schemaActions = {
  unlock: async (event: RequestEvent) => {
    const handled = await handleSchemaUnlock(event)
    if (handled.result.ok) redirect(303, '/schema')
    return fail(handled.status, { result: handled.result } satisfies SchemaActionData)
  },
  schema: async (event: RequestEvent) => {
    const handled = await handleSchemaResolve(event.request, 'action', event)
    const next = nextOf(event.url)
    // Решать уже нечего (другой экземпляр успел) — это не отказ: просто уходим.
    if (!handled) redirect(303, next ?? '/')
    if (handled.result.ok) redirect(303, next ?? '/schema')
    return fail(handled.status, { result: handled.result } satisfies SchemaActionData)
  },
}
