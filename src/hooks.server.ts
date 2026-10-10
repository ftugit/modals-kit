import { dbHandle } from '$lib/db/sveltekit'
import { DEMO_PRINCIPAL, getRuntime } from '$lib/server/db'
// Транспорт источника БД: первая отрисовка списка читается напрямую из слоя, а не
// через self-fetch. Ставится здесь, а не в лоадере страницы: лоадер `/paginator`
// — universal, его граф доходит и до браузера, а `$lib/server/*` — модули
// серверные. Это side-effect импорта на весь процесс: оба демо и API получают
// транспорт независимо от того, какой роут обрабатывает запрос.
import '$lib/server/db-list'
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
  // Контекст нужен всем путям демо: и странице, и /db-demo/submit (перехваченная
  // отправка формы), и /api/db-posts (доводка страниц пагинатора). Иначе догрузка
  // пошла бы без принципа и показала бы другое, чем первая страница.
  const path = event.url.pathname
  if (path !== '/db-demo' && !path.startsWith('/db-demo/') && !path.startsWith('/api/db-posts'))
    return resolve(event)
  const { db } = await getRuntime()
  const inject = dbHandle({ db, principal: () => DEMO_PRINCIPAL })
  return inject({ event, resolve } as never)
}
