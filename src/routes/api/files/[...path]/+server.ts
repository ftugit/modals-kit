// Потоковая раздача сохранённых файлов с поддержкой `Range` (`206 Partial Content`), `HEAD`
// и выбором сервера хранения (`?server=local|memory|<s3-slot>`, либо автоматически по `ledger`).
import type { RequestHandler } from './$types'
import { resolveRequestStorage } from '#server/storage.server.js'

export const GET: RequestHandler = async ({ params, request, url, cookies }) => {
  const storage = await resolveRequestStorage(cookies)
  const download = url.searchParams.get('download') === '1'
  const server = url.searchParams.get('server') ?? undefined
  return storage.serve(params.path, request, {
    download,
    ...(server ? { server } : {}),
  })
}

export const HEAD: RequestHandler = async ({ params, request, url, cookies }) => {
  const storage = await resolveRequestStorage(cookies)
  const download = url.searchParams.get('download') === '1'
  const server = url.searchParams.get('server') ?? undefined
  return storage.serve(params.path, request, {
    download,
    ...(server ? { server } : {}),
  })
}
