// Профиль по адресу (`/user/[id]`). Данные и отказ — ОДНА функция `load` для
// двух носителей: страницы и модалки `user.profile` (модалка берёт их через
// `preloadData` по `route`, своего `loader` у неё нет).
//
// Отказ приходит ДАННЫМИ, а не броском: брошенный `error(403)` оставил бы
// модалку в состоянии `status: 'error'`, её компонент не смонтировался бы и
// экран `Acl` показать было бы некому. Поэтому три исхода `profile()`
// (`fail(fact)` / `ok(null)` / `ok(view)`) переезжают в данные как есть, а
// Какой отказ показать, решает носитель (страница/модалка — только
// ACL-гейт); что рисовать из профиля, решает сам компонент профиля.
//
// `ok(null)` — это и «строки нет», и «она не видна текущему»: модель не отдаёт
// чужую строку молча (`policy.select` → `ownerOrRoles('auth_id', …)`), а не
// сообщает «запрещено». Различить эти два случая снаружи нельзя — и не нужно.
import type { PageServerLoad } from './$types'
import type { ProfileRouteData } from '#content/user/index.js'
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig } from '#content/user/index.js'
import { localStore } from '#server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export const load: PageServerLoad = async (event): Promise<ProfileRouteData> => {
  // Данные приватные: у `load` нет ни одного заголовка по умолчанию.
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.profile(event.params.id)
  if (r.ok) {
    return {
      uid: event.params.id,
      profile: r.value.profile,
      publicProfile: null,
      isOwn: r.value.isOwn,
      visibility: r.value.visibility,
      notCreated: r.value.notCreated,
      canEdit: r.value.canEdit,
      canDeleteProfile: r.value.canDeleteProfile,
      canDeleteSeed: r.value.canDeleteSeed,
      fullBlock: r.value.fullBlock,
      fact: null,
      enabled: u.enabled,
      limits: { nicknameForbidden: await config.get('nicknameForbidden') },
    }
  }

  // Обычное чтение недоступно (гость, чужой без прав): публичный показ
  // проекцией, если уровень видимости цели разрешает (этап 8). Не разрешает —
  // исходный факт: «нет/не видна» снаружи по-прежнему неразличимы.
  const p = await u.publicProfile(event.params.id)
  return {
    uid: event.params.id,
    profile: null,
    publicProfile: p.ok ? p.value : null,
    isOwn: false,
    visibility: 'nobody',
    notCreated: false,
    canEdit: false,
    canDeleteProfile: false,
    canDeleteSeed: false,
    fullBlock: null,
    fact: p.ok ? null : r.fact.code,
    enabled: u.enabled,
    limits: { nicknameForbidden: await config.get('nicknameForbidden') },
  }
}
