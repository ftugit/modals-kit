// Нативный путь: обычное действие SvelteKit поверх тех же слоёв.
import { fail, redirect, type Actions } from '@sveltejs/kit'
import { handleSignup } from './handle'

export const actions: Actions = {
  default: async (event) => {
    const { result, status } = await handleSignup(event.request, 'action', event)
    // Переход из ответа: адрес уже проверен библиотекой (только свой сайт).
    if (result.ok && result.redirect) redirect(303, result.redirect)
    return result.ok ? { result } : fail(status, { result })
  },
}
