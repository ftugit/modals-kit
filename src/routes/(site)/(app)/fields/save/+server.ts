// Перехваченный путь конструктора: тот же приём, ответ — `Result` в JSON.
import type { RequestHandler } from '@sveltejs/kit'
import { handleBuilder } from '../handle'

export const POST: RequestHandler = async (event) => {
  const { result, status } = await handleBuilder(event.request, 'fetch', event)
  return Response.json(result, { status: status === 0 ? 200 : status })
}
