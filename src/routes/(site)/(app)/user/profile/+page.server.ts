import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'
import { readVault } from '#content/user/gateway.js'
import { createUserConfig } from '#content/user/index.js'
import { localStore } from '#lib/server/cache.js'

const config = createUserConfig(localStore.scope('user-config'))

// Самостоятельный роут редактирования профиля пользователя.
// Собственный `actions` здесь не нужен: `<ProfileForm />` поднимает серверный
// POST на любом маршруте через `componentFormsHandle` и возвращает сюда же.
export const load: PageServerLoad = async (event) => {
  const user = await readVault(event.cookies).catch(() => null)
  if (!user) {
    const next = encodeURIComponent(event.url.pathname + event.url.search)
    redirect(303, `/user/auth?next=${next}`)
  }
  return {
    user,
    next: localPath(event.url.searchParams.get('next')),
    limits: {
      edge: await config.get('avatarEdge'),
      maxBytes: await config.get('avatarMaxBytes'),
      formats: await config.get('avatarFormats'),
    },
  }
}
