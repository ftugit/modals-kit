// Потоковая раздача сохранённых файлов (`storage.serve`) с поддержкой:
// - `Range` (`206 Partial Content`, в т.ч. склейки нарезанных между серверами частей и $O(1)$ AES-256-GCM),
// - `HEAD`, `ETag` (`304 Not Modified`), `416 Range Not Satisfiable`,
// - RFC 5987 `Content-Disposition` по оригинальному имени (`?download=1&name=...`) и `inline`-раздачи,
// - выбора сервера/реплики (`?server=...`), лимита скорости (`?rate=...`) и потоков (`?concurrency=...`).
import type { RequestHandler } from './$types'
import type { StorageServeOptions } from '#lib/storage/index.js'
import {
  resolveDemoConcurrencyOverride,
  resolveRequestStorage,
} from '#server/storage.server.js'

function parseServeQuery(url: URL): StorageServeOptions {
  const isDownload = url.searchParams.get('download') === '1'
  const rawName = url.searchParams.get('name')?.trim()
  const download: boolean | string = isDownload ? rawName || true : false

  const server = url.searchParams.get('server')?.trim() || undefined
  const cdn = url.searchParams.get('cdn') === '1'

  let rate: number | undefined
  const rawRate = url.searchParams.get('rate')?.trim()
  if (rawRate && rawRate !== 'default') {
    const parsed = Number(rawRate)
    if (Number.isFinite(parsed) && parsed >= 0) {
      rate = Math.floor(parsed)
    }
  }

  const concurrency = resolveDemoConcurrencyOverride(
    url.searchParams.get('concurrency')?.trim(),
  )

  return {
    download,
    ...(cdn ? { cdn: true } : {}),
    ...(server ? { server } : {}),
    ...(rate !== undefined ? { rate } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
  }
}

export const GET: RequestHandler = async ({ params, request, url, cookies }) => {
  const storage = await resolveRequestStorage(cookies)
  return storage.serve(params.path, request, parseServeQuery(url))
}

export const HEAD: RequestHandler = async ({ params, request, url, cookies }) => {
  const storage = await resolveRequestStorage(cookies)
  return storage.serve(params.path, request, parseServeQuery(url))
}
