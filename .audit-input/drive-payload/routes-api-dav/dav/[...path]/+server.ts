// Точка WebDAV «Диска»: все методы протокола идут в один обработчик.
// Аутентификация — пароль приложения (`Authorization: Basic`), а не seed:
// монтирование не должно давать доступ к аккаунту целиком.
import { AUTH_SEAL_SECRET } from '$app/env/private'
import type { RequestHandler } from './$types'
import { resolveAppStorage } from '#core/server/app-storage.server.js'
import { db } from '#core/server/db.server.js'
import { createDriveDav } from '#modules/drive/webdav.server.js'

const handle: RequestHandler = async ({ request }) => {
  if (!AUTH_SEAL_SECRET) {
    return new Response('Пароли WebDAV выключены: на сервере нет AUTH_SEAL_SECRET', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  const { storage } = await resolveAppStorage()
  const dav = createDriveDav({
    db,
    secretKey: AUTH_SEAL_SECRET,
    storage: storage
      ? {
          put: (input) => storage.put(input),
          del: (path) => storage.del(path),
          lazy: (path) => storage.lazy(path),
        }
      : null,
  })
  return dav.handle(request)
}

export const GET = handle
export const HEAD = handle
export const POST = handle
export const OPTIONS = handle
export const PUT = handle
export const DELETE = handle
export const fallback = handle
