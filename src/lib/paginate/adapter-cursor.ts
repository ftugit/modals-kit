import { createMemoryStorage } from './storage'
import type {
  AdapterInit,
  Extra,
  PageRequest,
  PageResponse,
  PaginatorAdapter,
  PaginatorStorage,
  PaginatorState,
} from './types'

export type CursorSource<T> = {
  id: string
  capabilities: {
    offsetRecovery: boolean
    stableAcrossSessions: boolean
  }
  load(input: {
    cursor?: string
    limit: number
    extra: Extra
    signal?: AbortSignal
  }): Promise<{
    items: T[]
    nextCursor?: string
    hasNext: boolean
    totalItems?: number
    totalPages?: number
  }>
}

type CursorState = {
  v: 1
  source: string
  fingerprint: string
  cursors: Record<string, string | null>
  exhaustedAt?: number
}

function encode(state: CursorState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(raw: string | undefined): CursorState | null {
  if (!raw || raw.length > 8192) return null
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CursorState>
    if (
      parsed.v !== 1 ||
      typeof parsed.source !== 'string' ||
      typeof parsed.fingerprint !== 'string' ||
      !parsed.cursors ||
      typeof parsed.cursors !== 'object'
    ) return null
    return parsed as CursorState
  } catch {
    return null
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function fingerprint(source: string, pageSize: number, extra: Extra): string {
  return `${source}|${pageSize}|${stable(extra)}`
}

export function createCursorAdapter<T>(options: {
  name: string
  source: CursorSource<T>
  storage?: PaginatorStorage
  pageSize?: number
  append?: boolean
}): PaginatorAdapter<T> {
  const storage = options.storage ?? createMemoryStorage()
  const pageSize = options.pageSize ?? 20
  let sourceState: CursorState = {
    v: 1,
    source: options.source.id,
    fingerprint: '',
    cursors: { '1': null },
  }

  function reset(nextFingerprint: string): void {
    sourceState = {
      v: 1,
      source: options.source.id,
      fingerprint: nextFingerprint,
      cursors: { '1': null },
    }
  }

  function ensureState(req: PageRequest): void {
    const next = fingerprint(options.source.id, req.pageSize, req.extra ?? {})
    if (sourceState.source !== options.source.id || sourceState.fingerprint !== next) reset(next)
  }

  async function loadPage(req: PageRequest): Promise<PageResponse<T>> {
    ensureState(req)
    let cursor = sourceState.cursors[String(req.page)] ?? undefined

    if (cursor === undefined && options.source.capabilities.offsetRecovery) {
      cursor = `o:${(req.page - 1) * req.pageSize}`
    }

    if (cursor === undefined) {
      cursor = sourceState.cursors['1'] ?? undefined
      for (let page = 1; page < req.page; page += 1) {
        const known = sourceState.cursors[String(page)] ?? undefined
        const response = await options.source.load({
          cursor: known,
          limit: req.pageSize,
          extra: req.extra ?? {},
          signal: req.signal,
        })
        if (!response.hasNext || !response.nextCursor) {
          sourceState.exhaustedAt = page
          return { items: [], hasNext: false, totalItems: response.totalItems, totalPages: response.totalPages }
        }
        sourceState.cursors[String(page + 1)] = response.nextCursor
        cursor = response.nextCursor
      }
    }

    const response = await options.source.load({
      cursor,
      limit: req.pageSize,
      extra: req.extra ?? {},
      signal: req.signal,
    })
    if (response.nextCursor && response.hasNext) sourceState.cursors[String(req.page + 1)] = response.nextCursor
    if (!response.hasNext) sourceState.exhaustedAt = req.page

    return {
      items: response.items,
      totalItems: response.totalItems,
      totalPages: response.totalPages,
      hasNext: response.hasNext,
    }
  }

  return {
    /**
     * Адрес этот адаптер НЕ трогает — ни читает, ни пишет, ни строит ссылки.
     *
     * Транспорт указателя страницы принадлежит адаптеру транспорта:
     * `createUrlAdapter` (страница в адресе: `hrefFor` + `setRouter`) или
     * `createLocalAdapter` (страница в хранилище). Курсорный адаптер отвечает
     * только за одно: перевести page-модель ядра в opaque cursor источника и
     * восстановиться из СВОЕГО хранилища. Отсутствие `hrefFor` здесь —
     * осознанное: без транспорта ссылок страниц нет, и `PageLink` честно
     * рендерит кнопку вместо `<a href>`, а не притворяется URL-адаптером.
     */
    getInitial: async (): Promise<AdapterInit<T>> => {
      const restored = await storage.read(options.name)
      const restoredState = decode(restored?.sourceState)
      if (restoredState?.source === options.source.id) sourceState = restoredState
      return {
        page: restored?.page ?? 1,
        pageSize: restored?.pageSize ?? pageSize,
        totalItems: restored?.totalItems ?? null,
        totalPages: restored?.totalPages ?? null,
        extra: restored?.extra ?? {},
        sourceState: restored?.sourceState,
      }
    },
    loadPage,
    persist(state: PaginatorState<T>): void | Promise<void> {
      return storage.write(options.name, {
        ...state,
        sourceState: encode(sourceState),
      })
    },
    capabilities: { append: options.append ?? true },
  }
}
