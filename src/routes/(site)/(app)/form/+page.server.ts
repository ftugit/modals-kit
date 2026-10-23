// Нативный путь: обычное действие SvelteKit поверх тех же слоёв.
import { fail, redirect, type Actions } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { handleSignup, jobStatus } from './handle.server'

// Адрес статуса заявки из очереди (`statusUrl`, `/form?job=…`): без скрипта
// человек открывает его сам и видит, готова ли запись.
export const load: PageServerLoad = ({ url }) => {
  const id = url.searchParams.get('job')
  if (!id) return { job: null }
  const s = jobStatus(id)
  return { job: s ? { done: s.done } : { missing: true as const } }
}

export const actions: Actions = {
  default: async (event) => {
    const { result, status } = await handleSignup(event.request, 'action', event)
    // Переход из ответа: адрес уже проверен библиотекой (только свой сайт).
    if (result.ok && result.redirect) redirect(303, result.redirect)
    return result.ok ? { result } : fail(status, { result })
  },
}
