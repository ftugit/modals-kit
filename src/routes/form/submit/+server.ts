// Перехваченный путь: тот же приём, другая кодировка ответа.
import type { RequestHandler } from '@sveltejs/kit'
import { handleSignup } from '$lib/ui/demo/form/handle'

export const POST: RequestHandler = async (event) => {
  const { result, status } = await handleSignup(event.request, 'fetch', event)
  return Response.json(result, { status: status === 0 ? 200 : status })
}
