import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { readVault } from '#content/user/gateway.js'

// Страница меню пользователя: без входа — на форму входа с возвратом сюда
// (валидность next проверяет сервер при выходе; это его обычный канал).
export const load: PageServerLoad = async (event) => {
  const user = await readVault(event.cookies).catch(() => null)
  if (!user) {
    const next = encodeURIComponent(event.url.pathname + event.url.search)
    redirect(303, `/user/auth?next=${next}`)
  }
  return { user }
}
