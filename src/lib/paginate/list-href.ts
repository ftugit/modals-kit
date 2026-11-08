// Адрес среза списка для POST без JS. Как хранить срез, решает адаптер
// пагинатора (`hrefFor`): форма сама адрес не пишет и GET не шлёт.
// `null` — у транспорта ссылок нет или путь не локальный. Поддельный GET
// на этот случай не подставляется.
import { localPath } from '#lib/address/index.js'
import { linkFor } from './core.js'
import { getPaginator, hasPaginator } from './registry.js'
import type { ExtraPatch, ExtraValue } from './types.js'

export function listHref(
  name: string,
  from: string,
  patch: ExtraPatch,
  pageSize?: number,
): string | null {
  if (!hasPaginator(name)) return null
  const raw = localPath(from)
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw, 'http://local.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'http://local.invalid') return null
  const search = Object.fromEntries(url.searchParams)
  const next: Record<string, ExtraValue | undefined> = { ...patch }
  if (pageSize !== undefined) {
    // Размер порции — не ключ extra. В адресе это `${pageParam}.size`,
    // и только если он отличается от дефолта пагинатора (как `ownKeys`).
    next.size = pageSize === getPaginator(name).pageSize ? undefined : pageSize
  }
  const query = linkFor(name, { page: 1, patch: next }, { search })
  if (query === null) return null
  const qs = query === '?' || query === '' ? '' : query
  return `${url.pathname}${qs}`
}
