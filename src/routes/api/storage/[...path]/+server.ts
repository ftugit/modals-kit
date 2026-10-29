// Потоковая раздача файлов боевого хранилища приложения (`serveAppStoragePath`):
// сильный `ETag`, `Accept-Ranges: bytes` (`206 Partial Content`), `immutable`
// кэширование версионированных объектов и изолирующие заголовки безопасности.
import type { RequestHandler } from './$types'
import { serveAppStoragePath } from '#server/app-storage.server.js'

export const GET: RequestHandler = async ({ params, request }) =>
  serveAppStoragePath(params.path, request)

export const HEAD: RequestHandler = async ({ params, request }) =>
  serveAppStoragePath(params.path, request)
