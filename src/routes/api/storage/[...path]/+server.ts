// Потоковая раздача файлов боевого хранилища приложения (`resolveAppStorage`):
// сильный `ETag`, `Accept-Ranges: bytes` (`206 Partial Content`) и `immutable`
// кэширование версионированных объектов (таких как `avatars/<uid>/<hash>.jpg`).
import type { RequestHandler } from './$types'
import { resolveAppStorage } from '#server/app-storage.server.js'

async function serveAppFile(path: string, request: Request): Promise<Response> {
  const resolved = await resolveAppStorage()
  if (!resolved.storage) {
    return new Response('Not Found', { status: 404 })
  }
  return resolved.storage.serve(path, request, {
    cacheControl: 'public, max-age=31536000, immutable',
    etag: 'strong',
  })
}

export const GET: RequestHandler = async ({ params, request }) =>
  serveAppFile(params.path, request)

export const HEAD: RequestHandler = async ({ params, request }) =>
  serveAppFile(params.path, request)
