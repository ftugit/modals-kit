/**
 * `/schema` — экран переноса схемы базы, отдельный от демо-маршрута.
 *
 * Зачем отдельный адрес: `schema_pending` отвечают ВСЕ страницы с БД, а не
 * только `/db-demo`, поэтому кнопка «Выполнить» обязана существовать вне демо.
 * `?next=` возвращает человека туда, откуда он пришёл (проверяется `localPath`).
 *
 * Экшен `?/schema` — тот же приём, что и остальные формы проекта: приём и
 * проверки живут в `handleSchemaResolve` (`#hooks/db-schema.server.js`), маршрут
 * выбирает только кодировку ответа. Успех — `303` (без JS тоже), чтобы страница
 * перечитала отчёт; отказ — `fail` с `Result` для формы.
 */
import { fail, redirect } from '@sveltejs/kit'
import { localPath } from '#lib/address/index.js'
import type { Result } from '#lib/form/index.js'
import { handleSchemaResolve, schemaScreen } from '#hooks/db-schema.server.js'
import type { Actions, PageServerLoad } from './$types'

/** Данные экшена при отказе: `Result` `#lib/form`, который подсаживается в форму. */
type SchemaActionData = { result: Result }

/** Куда вернуться после переноса; `null` — остаёмся на экране. */
const nextOf = (url: URL): string | null => localPath(url.searchParams.get('next'))

export const load: PageServerLoad = async ({ url }) => ({
  // Отчёт открывает ленивый драйвер мимо `gate`: при конфликте это единственный путь.
  screen: await schemaScreen(),
  next: nextOf(url),
  // Пришли сюда после успешного переноса (без `?next=`) — сказать об этом.
  justDone: url.searchParams.has('done'),
})

export const actions: Actions = {
  schema: async (event) => {
    const handled = await handleSchemaResolve(event.request, 'action', event)
    const next = nextOf(event.url)
    // Решать уже нечего (другой экземпляр успел) — это не отказ: просто уходим.
    if (!handled) redirect(303, next ?? '/')
    if (handled.result.ok) redirect(303, next ?? '/schema?done=1')
    return fail(handled.status, { result: handled.result } satisfies SchemaActionData)
  },
}
