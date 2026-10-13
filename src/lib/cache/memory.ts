// Хранилище в памяти процесса. Заменяет семь самописных копий «Map + срок +
// потолок + вычистка», которые жили по модулю на каждое место.
//
// Однопоточный JS делает `add` и `incr` атомарными: между проверкой и записью
// нет `await`. Атомарны они в пределах ПРОЦЕССА: другие инстансы этой памяти не
// видят. Для общего между инстансами — сетевое хранилище с тем же контрактом.
import type { AtomicStore, ScopeOptions } from './types'

/** Память отвечает сразу: те же методы, но без обещаний. */
export interface MemoryStore extends AtomicStore {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T, ttlMs: number): void
  delete(key: string): void
  clear(): void
  add<T>(key: string, value: T, ttlMs: number): boolean
  incr(key: string, ttlMs: number): number
  scope(name: string, options?: ScopeOptions): MemoryStore
  /** Записей в этой области (без вложенных); просроченные, но не вычищенные, тоже. */
  readonly size: number
}

export interface MemoryStoreOptions {
  /** Потолок записей корневой области. По умолчанию 1000. */
  max?: number
  /** Потолок вложенной области, если `scope` не задал свой. По умолчанию 1000. */
  scopeMax?: number
  /** Часы — для тестов. */
  now?: () => number
}

const DEFAULT_MAX = 1000
/** Полный обход области — не чаще раза в минуту: просроченное не копится. */
const SWEEP_MS = 60_000

type Entry = { value: unknown; exp: number }

interface Area {
  readonly map: Map<string, Entry>
  max: number
  /** Потолок задан явно. Промежуточная область (`a` в `scope('a:b')`) — нет, пока её не запросят с `max`. */
  fixed: boolean
  readonly children: Map<string, Area>
  sweptAt: number
}

function checkMax(max: number, where: string): number {
  if (!Number.isInteger(max) || max < 1)
    throw new RangeError(`[cache] ${where}: max — целое число от 1, получено ${String(max)}`)
  return max
}

function checkTtl(ttlMs: number): number {
  if (!(ttlMs > 0))
    throw new RangeError(`[cache] ttlMs — положительное число мс или Infinity, получено ${String(ttlMs)}`)
  return ttlMs
}

/**
 * Хранилище в памяти процесса.
 *
 * Вытеснение: когда область полна, уходит самая старая по записи. `set`
 * переносит ключ в конец очереди, так что при одинаковых сроках самая старая
 * запись — первая кандидатка и на просрочку. Точный LRU здесь стоит дороже, чем
 * даёт. Просроченные записи удаляются при чтении и обходом области не чаще раза
 * в минуту.
 * @param options Потолки и часы.
 * @returns Хранилище; `scope` создаёт области со своими потолками.
 */
export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  const now = options.now ?? Date.now
  const scopeMax = checkMax(options.scopeMax ?? DEFAULT_MAX, 'scopeMax')
  const newArea = (max: number, fixed = true): Area => ({ map: new Map(), max, fixed, children: new Map(), sweptAt: now() })
  return view(newArea(checkMax(options.max ?? DEFAULT_MAX, 'max')))

  function live(area: Area, key: string, t: number): Entry | undefined {
    const hit = area.map.get(key)
    if (hit && hit.exp <= t) {
      area.map.delete(key)
      return undefined
    }
    return hit
  }

  /** Освободить место под НОВЫЙ ключ и вписать его в конец очереди. */
  function insert(area: Area, key: string, entry: Entry, t: number): void {
    if (t - area.sweptAt >= SWEEP_MS) {
      area.sweptAt = t
      for (const [k, v] of area.map) if (v.exp <= t) area.map.delete(k)
    }
    area.map.delete(key)
    while (area.map.size >= area.max) {
      const oldest = area.map.keys().next()
      if (oldest.done) break
      area.map.delete(oldest.value)
    }
    area.map.set(key, entry)
  }

  function clearArea(area: Area): void {
    area.map.clear()
    for (const child of area.children.values()) clearArea(child)
  }

  function child(area: Area, name: string, opts: ScopeOptions | undefined): Area {
    if (name === '') throw new TypeError('[cache] scope: имя области не может быть пустым')
    const existing = area.children.get(name)
    if (existing) {
      if (opts?.max === undefined || opts.max === existing.max) return existing
      if (!existing.fixed) {
        existing.max = checkMax(opts.max, `scope «${name}»`)
        existing.fixed = true
        return existing
      }
      throw new RangeError(
        `[cache] scope «${name}» уже создана с max ${existing.max}, повторно запрошен max ${opts.max}: два места делят одно имя?`,
      )
    }
    const created = newArea(checkMax(opts?.max ?? scopeMax, `scope «${name}»`), opts?.max !== undefined)
    area.children.set(name, created)
    return created
  }

  function view(area: Area): MemoryStore {
    return {
      get<T>(key: string) {
        return live(area, key, now())?.value as T | undefined
      },
      set(key, value, ttlMs) {
        const t = now()
        insert(area, key, { value, exp: t + checkTtl(ttlMs) }, t)
      },
      delete(key) {
        area.map.delete(key)
      },
      clear() {
        clearArea(area)
      },
      add(key, value, ttlMs) {
        const t = now()
        checkTtl(ttlMs)
        if (live(area, key, t)) return false
        insert(area, key, { value, exp: t + ttlMs }, t)
        return true
      },
      incr(key, ttlMs) {
        const t = now()
        checkTtl(ttlMs)
        const hit = live(area, key, t)
        if (!hit) {
          insert(area, key, { value: 1, exp: t + ttlMs }, t)
          return 1
        }
        if (typeof hit.value !== 'number')
          throw new TypeError(`[cache] incr «${key}»: под ключом не число`)
        // Срок и место в очереди не трогаем: окно счётчика фиксировано с создания.
        hit.value += 1
        return hit.value
      },
      scope(name, opts) {
        // `scope('a:b')` — то же, что `scope('a').scope('b')`: у сетевых хранилищ
        // это один и тот же префикс ключей, у памяти должна быть одна и та же область.
        const parts = name.split(':')
        let target = area
        parts.forEach((part, i) => {
          target = child(target, part, i === parts.length - 1 ? opts : undefined)
        })
        return view(target)
      },
      get size() {
        return area.map.size
      },
    }
  }
}
