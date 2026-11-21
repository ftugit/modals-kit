// Section: авторизация (`/user/auth`) — load вынесен из route.
import { redirect, type RequestEvent } from '@sveltejs/kit'
import { auth, readVault } from '#modules/user/base/service/gateway.server.js'
import { createUserConfig, resolveAuthStep } from '#modules/user/base/index.js'
import type { UserAuthRouteData } from './types.js'
import { userAuthRoute } from '#modules/user/base/routes.js'
import { localStore } from '#core/server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))


export async function loadUserAuth(event: RequestEvent): Promise<UserAuthRouteData> {
  const { stage, next } = userAuthRoute.parse(event.url)
  const step = resolveAuthStep(stage) || 'auth.entry'

  let registerSeed: string | null = null
  if (step === 'auth.register') {
    const { generateKeyPair } = await import('#modules/user/base/service/keys.js')
    registerSeed = (await generateKeyPair()).secret
  }
  const u = auth(event)
  // Живой `auth_tmp` при удалённой/отозванной строке сессии — не «уже вошёл»:
  // защищённые страницы уже говорят `session_expired`, а форма входа отвечала
  // `guest_only`. Снимаем мёртвые куки и перечитываем адрес как гость.
  if (await readVault(event.cookies)) {
    const who = await u.actor()
    if (!who.ok && who.fact.code === 'auth.session-unknown') {
      await u.logoutLocal()
      redirect(303, `${event.url.pathname}${event.url.search}`)
    }
  }
  const challenge = u.enabled ? await u.issueChallenge() : null

  return {
    enabled: u.enabled,
    challenge: challenge?.ok ? challenge.value : null,
    next,
    step,
    registerSeed,
    limits: {
      nicknameForbidden: await config.get('nicknameForbidden'),
      holdSeconds: await config.get('holdSeconds'),
    },
  }
}
