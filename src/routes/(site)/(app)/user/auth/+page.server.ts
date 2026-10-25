// Роут авторизации и шагов аккаунта (`auth.*`, `blocked`, `restrictions`, `profile`).
// Все POST-экшены обрабатываются общим хуком `#hooks/component-form`,
// а снимок сессии `user` централизованно поставляет корневой `+layout.server.ts`.
import type { PageServerLoad } from './$types'
import { IMAGE_MIME_TYPES } from '#components/form/image.js'
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig, resolveAuthStep } from '#content/user/index.js'
import { userAuthRoute } from '#content/user/routes.js'
import { localStore } from '#server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))
const INPUT_PHOTO_FORMATS = IMAGE_MIME_TYPES.map((mime: string) => mime.replace(/^image\//, ''))

export const load: PageServerLoad = async (event) => {
  const { stage, next } = userAuthRoute.parse(event.url)
  const step = resolveAuthStep(stage) || 'auth.entry'

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
