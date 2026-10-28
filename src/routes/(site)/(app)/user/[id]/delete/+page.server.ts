// Удаление профиля по адресу (`/user/[id]/delete`) — носитель пары
// `user.profile.delete`: только ACL-гейт по флагу `canDeleteProfile`
// чтения профиля, дальше компонент `ProfileDelete`. Отказ — данными,
// как у чтения: страницу рисует носитель экраном `Acl`. Отправка формы
// обрабатывается общим хуком component-form, экшенов у роута нет.
import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig } from '#content/user/index.js'
import type { ProfileDeleteRouteData } from '#content/user/types.js'
import { localStore } from '#server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export const load: PageServerLoad = async (event): Promise<ProfileDeleteRouteData> => {
  // Данные приватные: у `load` нет ни одного заголовка по умолчанию.
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.profile(event.params.id)

  return {
    uid: event.params.id,
    enabled: u.enabled,
    canDeleteProfile: r.ok ? r.value.canDeleteProfile : false,
    canDeleteSeed: r.ok ? r.value.canDeleteSeed : false,
    holdSeconds: await config.get('holdSeconds'),
    fact: r.ok ? null : r.fact.code,
  }
}
