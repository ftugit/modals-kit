// Нативный путь: обычное действие SvelteKit поверх тех же слоёв.
import { fail, type Actions } from '@sveltejs/kit'
import { handleSignup } from './handle'

export const actions: Actions = {
  default: async ({ request }) => {
    const { result, status } = await handleSignup(request, 'action')
    return result.ok ? { result } : fail(status, { result })
  },
}
