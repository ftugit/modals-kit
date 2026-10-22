/**
 * Страница `/user/menu` для пользователей без JS и прямой навигации: рендерит
 * то же тело `MenuBody`, что и модалка `MenuModal`. Гостевой доступ штатно
 * закрыт компонентом `<Acl allow="user">` внутри `MenuBody` без серверного
 * `303`-редиректа.
 */
import type { PageServerLoad } from './$types'
import { readVault } from '#content/user/gateway.js'

export const load: PageServerLoad = async (event) => ({
  user: await readVault(event.cookies).catch(() => null),
})
