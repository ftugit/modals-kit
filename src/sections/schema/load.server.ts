// Section: перенос схемы базы (`/schema`) — load/actions вынесены из route.
import type { RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { localPath } from '#core/lib/address/index.js'
import type { Result } from '#core/lib/form/index.js'
import { handleSchemaResolve, schemaScreen } from '#core/hooks/db-schema.server.js'
import type { SchemaActionData } from './types.js'

/** Данные экшена при отказе: `Result` `#core/lib/form`, который подсаживается в форму. */
export type { SchemaActionData } from './types.js'

/** Куда вернуться после переноса; `null` — остаёмся на экране. */
const nextOf = (url: URL): string | null => localPath(url.searchParams.get('next'))

export async function loadSchema({ url }: { url: URL }) {
  return {
    // Отчёт открывает ленивый драйвер мимо `gate`: при конфликте это единственный путь.
    screen: await schemaScreen(),
    next: nextOf(url),
    // Пришли сюда после успешного переноса (без `?next=`) — сказать об этом.
    justDone: url.searchParams.has('done'),
  }
}

export const schemaActions = {
  schema: async (event: RequestEvent) => {
    const handled = await handleSchemaResolve(event.request, 'action', event)
    const next = nextOf(event.url)
    // Решать уже нечего (другой экземпляр успел) — это не отказ: просто уходим.
    if (!handled) redirect(303, next ?? '/')
    if (handled.result.ok) redirect(303, next ?? '/schema?done=1')
    return fail(handled.status, { result: handled.result } satisfies SchemaActionData)
  },
}
