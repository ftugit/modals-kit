// Перехваченный путь: тот же приём, другая кодировка ответа.
import { json, type RequestHandler } from '@sveltejs/kit'
import { handleSignup } from '../handle'

export const POST: RequestHandler = async ({ request }) => {
  const { result, status } = await handleSignup(request, 'fetch')
  return json(result, { status: status === 0 ? 200 : status })
}
