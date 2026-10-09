// Хранилища — ГДЕ лежит объявленная часть цепочки.
// Чистые стратегии: про фреймворк не знают, всё нужное получают из движка.
//
// transient-записи здесь не хранятся вообще и никогда: их содержимое живёт
// в памяти, поэтому сохранённый id указывал бы в никуда. Их держит
// сам адаптер, в состоянии записи истории.
import { chainToSearch, decodeChain } from './core'
import type { AnyDefinition } from './registry'
import type { RegisteredEntry } from './types'

/** Что хранилище получает от движка. */
export interface StorageEnv {
  location(): { pathname: string; search: string }
  lookup(name: string): AnyDefinition | undefined
}

export interface ChainStorage {
  readonly name: string
  /** Цепочка видна в адресе → её можно передать ссылкой. */
  readonly addressable: boolean
  /** Цепочка переживает перезагрузку. */
  readonly durable: boolean

  read(env: StorageEnv): RegisteredEntry[]

  /**
   * Каким должен стать адрес. `null` — адрес не трогаем; движок всё равно
   * сделает запись истории, поэтому Назад/Вперёд продолжают работать.
   */
  urlFor(entries: RegisteredEntry[], env: StorageEnv): string | null

  /** Запись в собственный носитель. У адресного хранилища не нужна. */
  commit?(entries: RegisteredEntry[], env: StorageEnv): void
}

/* ── в адресе ──────────────────────────────────────────────────────── */

/** Цепочка в строке запроса: `?modal=card,user&modal.1.id=7`. */
export function urlStorage(): ChainStorage {
  return {
    name: 'url',
    addressable: true,
    durable: true,
    read: (env) => decodeChain(env.location().search, env.lookup),
    urlFor(entries, env) {
      const { pathname, search } = env.location()
      return pathname + chainToSearch(entries, env.lookup, new URLSearchParams(search))
    },
  }
}

/* ── в localStorage ────────────────────────────────────────────────── */

/** Минимальная адаптация localStorage, удобная для SSR и тестовых подмен. */
export interface MinimalStorage {
  /** Читает строку по ключу или null при её отсутствии. */
  getItem(key: string): string | null
  /** Записывает строковое значение по ключу. */
  setItem(key: string, value: string): void
  /** Удаляет значение по ключу. */
  removeItem(key: string): void
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Разбор одной записи. Подделка в devtools не должна валить стопку. */
function parseEntry(raw: unknown): RegisteredEntry | null {
  if (!isRecord(raw)) return null
  if (typeof raw.name !== 'string' || raw.name === '') return null
  return {
    kind: 'registered',
    name: raw.name,
    params: isRecord(raw.params) ? raw.params : {},
    overrides: isRecord(raw.overrides) ? (raw.overrides as RegisteredEntry['overrides']) : {},
  }
}

/** Безопасно разбирает JSON-значение носителя в зарегистрированные записи. */
export function parseStoredChain(raw: string | null): RegisteredEntry[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [] // битый JSON — пустая стопка, а не исключение
  }
  if (!Array.isArray(parsed)) return []
  const out: RegisteredEntry[] = []
  for (const item of parsed) {
    const entry = parseEntry(item)
    if (entry) out.push(entry) // мусорная запись выбрасывается по одной
  }
  return out
}

/**
 * Цепочка в localStorage. Адрес чистый, зато при живом движке
 * Назад/Вперёд работают — именно это вложение «движок(хранилище)»
 * и позволяет выразить.
 */
export function localStorageChain(storage: MinimalStorage, key = 'modals:chain'): ChainStorage {
  return {
    name: 'local',
    addressable: false,
    durable: true,
    read() {
      // Чтение тоже может бросить: в стороннем iframe и при заблокированном
      // хранилище сам доступ к localStorage даёт SecurityError. Раньше здесь
      // защиты не было, и падало не «хранилище», а вся модальная система.
      try {
        return parseStoredChain(storage.getItem(key))
      } catch {
        return []
      }
    },
    // адрес не наш — движок сделает запись истории на текущем URL
    urlFor: (_entries, env) => {
      const { pathname, search } = env.location()
      return pathname + search
    },
    commit(entries) {
      try {
        if (entries.length === 0) storage.removeItem(key)
        else storage.setItem(key, JSON.stringify(entries))
      } catch {
        // приватный режим или квота: стопка останется в памяти вкладки.
        // Падать нельзя — модалка важнее долговечности.
      }
    },
  }
}

/* ── в памяти ──────────────────────────────────────────────────────── */

/** Ничего не переживает и не отражается в адресе. SSR, тесты, встраивание. */
export function memoryStorage(initial: RegisteredEntry[] = []): ChainStorage {
  let entries = initial
  return {
    name: 'memory',
    addressable: false,
    durable: false,
    read: () => entries,
    urlFor: (_e, env) => {
      const { pathname, search } = env.location()
      return pathname + search
    },
    commit(next) {
      entries = next
    },
  }
}
