// Кто выполняет запрос — единственная точка, где проверка сессии встречается
// с `DataContext`.
//
// `lib/db` про сессии не знает (портируемый слой), `guard` про модели не
// знает. Здесь они сходятся: `guard` читает токен, сессию и строку `auth`
// (включая блокировку и заявку на удаление), результат кладётся в
// `principal`, остальное (requestId, signal) добавляет `createRequestContext`.
//
// Фильтровать по URL нельзя: компонентная форма приходит на тот адрес, где
// стоит модалка (`#hooks/component-form`), а не на «свой» маршрут.
//
// Цена — два SELECT (`sessions.get`, `auths.get`) на ПЕРВЫЙ вызов в запросе;
// повторные бесплатны: промис лежит в `event.locals.actor` и живёт столько же,
// сколько запрос. Присваивание синхронное (до первого `await`), поэтому
// параллельные обращения делят одно вычисление.
//
// Отказ `guard` — гость: ни `id`, ни ролей. Причина (`auth.blocked`,
// `auth.expired`, …) здесь не различается: до правил модели она не доходит,
// а пользователю её показывает тот, кто вызвал api, а не контекст.
import type { RequestEvent } from '@sveltejs/kit'
import type { DataContext } from '#lib/db/index.js'
import { createRequestContext, type Principal } from '#lib/db/sveltekit/index.js'
import { guard } from '#content/user/auth.js'
import { ACCESS_COOKIE, authPorts } from '#content/user/gateway.server.js'

/**
 * Личность запроса. `roles: ['user']` — маркер «сессия проверена», не права:
 * реальные роли аккаунта появятся отдельным шагом.
 */
async function principalOf(event: RequestEvent): Promise<Principal> {
  // Порты без куки: `guard` их не трогает — он читает токен, сессию и строку auth.
  const g = await guard(authPorts(), event.cookies.get(ACCESS_COOKIE))
  return 'code' in g ? { roles: [] } : { id: g.sub, roles: ['user'] }
}

/**
 * `DataContext` этого запроса: от чьего имени писать в БД.
 *
 * Первый вызов стоит два SELECT, остальные отдают тот же промис.
 */
export function actorOf(event: RequestEvent): Promise<DataContext> {
  return (event.locals.actor ??= principalOf(event).then((p) => createRequestContext(event, p)))
}
