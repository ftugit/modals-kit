import { dbHandle } from '$lib/db/sveltekit'
import { DEMO_PRINCIPAL, getRuntime } from '$lib/server/db'
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
  // Список догружается с /api/db-posts (страницы пагинатора) — контекст нужен и там,
  // иначе догрузка пойдёт без принципа и покажет другое, чем первая страница.
  if (event.url.pathname !== '/db-demo' && !event.url.pathname.startsWith('/api/db-posts'))
    return resolve(event)
  const { db } = await getRuntime()
  const inject = dbHandle({ db, principal: () => DEMO_PRINCIPAL })
  return inject({ event, resolve } as never)
}
