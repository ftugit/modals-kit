// Роут авторизации и шагов аккаунта (`auth.*`, `blocked`, `restrictions`, `profile`).
// Все POST-экшены обрабатываются общим хуком `#hooks/component-form`,
// а снимок сессии `user` централизованно поставляет корневой `+layout.server.ts`.
import { localPath } from '#lib/address/index.js'
import type { PageServerLoad } from './$types'
import { SERVER_PHOTO_FORMATS } from '#content/user/checks.js'
import { auth } from '#content/user/gateway.js'
import { createUserConfig, resolveAuthStep } from '#content/user/index.js'
import { localStore } from '#lib/server/cache.js'

const config = createUserConfig(localStore.scope('user-config'))
const INPUT_PHOTO_FORMATS = SERVER_PHOTO_FORMATS.map((mime) => mime.replace(/^image\//, ''))

export const load: PageServerLoad = async (event) => {
  const url = event.url
  const next = localPath(url.searchParams.get('next'))
  const step = resolveAuthStep(url.searchParams.get('stage')) || 'auth.entry'

  let registerSeed: string | null = null
  if (step === 'auth.register') {
    const { generateKeyPair } = await import('#content/user/keys.js')
    registerSeed = (await generateKeyPair()).secret
  }
  const u = auth(event)
  const challenge = u.enabled ? await u.issueChallenge() : null

  return {
    enabled: u.enabled,
    challenge: challenge?.ok ? challenge.value : null,
    next,
    step,
    registerSeed,
    limits: {
      edge: await config.get('avatarEdge'),
      maxBytes: await config.get('avatarMaxBytes'),
      formats: INPUT_PHOTO_FORMATS,
      nicknameForbidden: await config.get('nicknameForbidden'),
      holdSeconds: await config.get('holdSeconds'),
    },
  }
}
