// Маршрут-страница: приём формы — регистрация `#hooks/component-form`
// (`signup.form.server.ts`), поэтому здесь остался только чтение адреса.
import type { PageServerLoad } from './$types'
import { jobStatus } from './queue.server'

// Адрес статуса заявки из очереди (`statusUrl`, `/form?job=…`): без скрипта
// человек открывает его сам и видит, готова ли запись.
export const load: PageServerLoad = async ({ url }) => {
  const id = url.searchParams.get('job')
  if (!id) return { job: null }
  const s = await jobStatus(id)
  return { job: s ? { done: s.done } : { missing: true as const } }
}
