// Нативный путь `/fields`: два form-экшена поверх тех же слоёв, что и перехват
// (`./save`, `./record`). Данные страницы — из кэша процесса.
import { fail, type Actions } from '@sveltejs/kit'
import type { Handled } from '#lib/form/server.js'
import { handleBuilder, handleRecord, savedRecord, savedSet } from './handle'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = () => ({ set: savedSet(), record: savedRecord() })

/** `intent` — какой из двух форм достался ответ: `form` у SvelteKit один на страницу. */
async function act(intent: 'save' | 'record', promise: Promise<Handled>) {
  const { result, status } = await promise
  return result.ok ? { result, intent } : fail(status, { result, intent })
}

export const actions: Actions = {
  save: (event) => act('save', handleBuilder(event.request, 'action', event)),
  record: (event) => act('record', handleRecord(event.request, 'action', event)),
}
