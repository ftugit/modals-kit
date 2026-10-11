// Нативный путь: обычное действие SvelteKit поверх тех же слоёв.
import { fail, type Actions } from '@sveltejs/kit'
import { handleSignup } from '$lib/ui/demo/form/handle'

export const actions: Actions = {
  default: async (event) => {
    const { result, status } = await handleSignup(event.request, 'action', event)
    return result.ok ? { result } : fail(status, { result })
  },
}
