// Перехваченный путь: тот же приём, другая кодировка ответа.
import { json, type RequestHandler } from '@sveltejs/kit'
import { handleSignup, jobStatus } from '../handle'

export const POST: RequestHandler = async (event) => {
  const { result, status } = await handleSignup(event.request, 'fetch', event)
  return Response.json(result, { status: status === 0 ? 200 : status })
}

// Опрос заявки из очереди (`pollUrl`): `{ done, retryAfterMs }` или `{ done, result }`.
export const GET: RequestHandler = ({ url }) => {
  const s = jobStatus(url.searchParams.get('job') ?? '')
  return s ? json(s, { headers: { 'cache-control': 'no-store' } }) : json({ error: 'job.missing' }, { status: 404 })
}
