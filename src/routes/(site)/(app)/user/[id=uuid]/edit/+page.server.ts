// Редактирование профиля по адресу (`/user/[id]/edit`) — носитель пары
// `user.profile.edit`: только ACL-гейт по флагу правки чтения профиля,
// дальше форма `ProfileForm` по id. Значения формы — из того же чтения
// (`initial`), права на запись перепроверит серверная форма и модель.
import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig } from '#content/user/index.js'
import { localStore } from '#server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export const load: PageServerLoad = async (event) => {
  // Данные приватные: у `load` нет ни одного заголовка по умолчанию.
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.profile(event.params.id)

  return {
    uid: event.params.id,
    profile: r.ok ? r.value.profile : null,
    canEdit: r.ok ? r.value.canEdit : false,
    canDeleteProfile: r.ok ? r.value.canDeleteProfile : false,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    limits: { nicknameForbidden: await config.get('nicknameForbidden') },
  }
}
