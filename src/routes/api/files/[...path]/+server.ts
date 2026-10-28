// Потоковая раздача сохранённых файлов с поддержкой `Range` (`206 Partial Content`) и `HEAD`.
import type { RequestHandler } from './$types'
import { appStorage } from '#server/storage.server.js'

export const GET: RequestHandler = async ({ params, request, url }) => {
  const download = url.searchParams.get('download') === '1'
  return appStorage.serve(params.path, request, { download })
}

export const HEAD: RequestHandler = async ({ params, request, url }) => {
  const download = url.searchParams.get('download') === '1'
  return appStorage.serve(params.path, request, { download })
}
