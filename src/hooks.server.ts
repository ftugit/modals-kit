import { dbHandle } from '$lib/db/sveltekit'
import { getRuntime } from '$lib/server/db'
import type { Handle } from '@sveltejs/kit'

/**
 * Доверенный контекст: principal выдаёт только сервер (здесь — демо-«автор»),
 * `signal` берёт сам рантайм (ушёл со страницы → SQL отменяется). Роль из
 * query-параметра появиться не может физически: DataContext собирает пакет.
 *
 * getRuntime() — ленивый: PGlite поднимается только для путей, где есть
 * обращение к БД, а не на каждый запрос приложения.
 */
export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname !== '/db-demo') return resolve(event)
  const { db } = await getRuntime()
  const inject = dbHandle({ db, principal: () => ({ roles: ['author'] }) })
  return inject({ event, resolve } as never)
}
