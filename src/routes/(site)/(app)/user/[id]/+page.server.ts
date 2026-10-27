// Профиль по адресу (`/user/[id]`). Данные и отказ — ОДНА функция `load` для
// двух носителей: страницы и модалки `user.profile` (модалка берёт их через
// `preloadData` по `route`, своего `loader` у неё нет).
//
// Отказ приходит ДАННЫМИ, а не броском: брошенный `error(403)` оставил бы
// модалку в состоянии `status: 'error'`, её компонент не смонтировался бы и
// экран `Acl` показать было бы некому. Поэтому три исхода `profile()`
// (`fail(fact)` / `ok(null)` / `ok(view)`) переезжают в данные как есть, а
// какой экран из них следует, решает `ProfileScreen`.
//
// `ok(null)` — это и «строки нет», и «она не видна текущему»: модель не отдаёт
// чужую строку молча (`policy.select` → `ownerOrRoles('auth_id', …)`), а не
// сообщает «запрещено». Различить эти два случая снаружи нельзя — и не нужно.
import type { PageServerLoad } from './$types'
import type { ProfileScreenData } from '#content/user/index.js'
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig } from '#content/user/index.js'
import { localStore } from '#server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export const load: PageServerLoad = async (event): Promise<ProfileScreenData> => {
  // Данные приватные: у `load` нет ни одного заголовка по умолчанию.
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.profile(event.params.id)

  return {
    uid: event.params.id,
    profile: r.ok ? r.value.profile : null,
    notCreated: r.ok ? r.value.notCreated : false,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    limits: { nicknameForbidden: await config.get('nicknameForbidden') },
  }
}
