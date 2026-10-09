/**
 * Изоморфное fuzzy-ядро поиска: нормализация, взвешенная дистанция
 * Дамерау-Левенштейна, словарь терминов корпуса и коррекция опечаток.
 *
 * Клиентское улучшение: сервер ищет точно/подстрокой, а этот модуль исправляет
 * опечатки ДО сопоставления — по словарю реальных терминов корпуса, поэтому
 * знает и имена собственные («Наруто»), которых нет в орфографических словарях.
 * Модуль без зависимостей и без server-импортов (гейт `search-fuzzy.mjs`);
 * он никогда не владеет транспортом, пагинацией или курсорами источника.
 */

// ------------------------------------------------------------------ fold ----

/** Гомоглифы латиница→кириллица: визуально неразличимые буквы. */
const HOMOGLYPHS: Record<string, string> = {
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  k: 'к',
  b: 'в',
  m: 'м',
  t: 'т',
  h: 'н',
  u: 'у',
}

/**
 * Ключ сопоставления: NFD → без диакритики → нижний регистр → ё→е → гомоглифы.
 * Применяется к ОБЕИМ сторонам (словарь и запрос): «Nаrutо» со смешанными
 * буквами сворачивается к тому же ключу, что и «naruto».
 */
export function foldKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[acepoxyukbmthu]/g, (c) => HOMOGLYPHS[c] ?? c)
}

// --------------------------------------------------------------- distance ---

/**
 * Типовые конфузии языков — пары символов, замена между которыми стоит 0.5
 * вместо 1: безударные о/а, е/и, звонкие/глухие и т.п.
 */
const CONFUSIONS: ReadonlySet<string> = new Set([
  'а/о', 'о/а', 'е/и', 'и/е', 'и/ы', 'ы/и', 'е/э', 'э/е', 'ь/ъ', 'ъ/ь',
  'д/т', 'т/д', 'б/п', 'п/б', 'г/к', 'к/г', 'ж/ш', 'ш/ж', 'з/с', 'с/з',
  'в/ф', 'ф/в', 'ч/щ', 'щ/ч',
  'a/o', 'o/a', 'e/i', 'i/e', 'i/y', 'y/i', 'o/u', 'u/o',
])

/** Стоимость замены символа: 0.5 для типовой конфузии, 1 для остальных. */
export function substitutionCost(a: string, b: string): number {
  return CONFUSIONS.has(`${a}/${b}`) ? 0.5 : 1
}

/**
 * Взвешенная дистанция Дамерау-Левенштейна (optimal string alignment):
 * вставка/удаление — 1, транспозиция соседних — 1, замена — {@link substitutionCost}.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n

  let prev2 = new Float64Array(m + 1)
  let prev = new Float64Array(m + 1)
  let cur = new Float64Array(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j

  for (let i = 1; i <= n; i++) {
    cur[0] = i
    for (let j = 1; j <= m; j++) {
      const ins = cur[j - 1] + 1
      const del = prev[j] + 1
      const sub =
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : substitutionCost(a[i - 1], b[j - 1]))
      let best = Math.min(ins, del, sub)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, prev2[j - 2] + 1)
      }
      cur[j] = best
    }
    const t = prev2
    prev2 = prev
    prev = cur
    cur = t
  }
  return prev[m]
}

/** Порог стоимости исправления по длине ключа (короткие слова — строже). */
export function maxCostFor(key: string): number {
  return key.length <= 4 ? 1 : 2
}

// -------------------------------------------------------------- dictionary --

/** Элемент словаря терминов корпуса. */
export interface TermDictionaryEntry {
  /** Ключ словаря ({@link foldKey}). */
  key: string
  /** Исходная (поверхностная) форма — ею переписывается запрос. */
  display: string
  /** В скольких документах корпуса встречается. */
  df: number
}

/** Словарь терминов корпуса: ключ {@link foldKey} → элемент. */
export type TermDictionary = Map<string, TermDictionaryEntry>

/** Минимальная длина слова, попадающего в словарь/коррекцию. */
export const MIN_TERM_LEN = 2

/** Токенизация: Unicode-буквы и цифры, нижний регистр. */
export function tokenize(text: string): string[] {
  return (
    text
      .normalize('NFC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}

/**
 * Построить словарь терминов из текстов корпуса (df — число документов со словом).
 * Изоморфно: на сервере словарь собирается один раз и раздаётся артефактом
 * ({@link serializeTermDictionary}); fuzzy-сопоставление на сервере не выполняется.
 */
export function buildTermDictionary(texts: readonly string[]): TermDictionary {
  const dict: TermDictionary = new Map()
  for (const text of texts) {
    const seen = new Set<string>()
    for (const tok of tokenize(text)) {
      if (tok.length < MIN_TERM_LEN) continue
      const key = foldKey(tok)
      if (seen.has(key)) continue
      seen.add(key)
      const e = dict.get(key)
      if (e) e.df += 1
      else dict.set(key, { key, display: tok, df: 1 })
    }
  }
  return dict
}

/** Артефакт словаря: строки `display\tdf` (ключ пересчитывается при загрузке). */
export function serializeTermDictionary(dict: TermDictionary): string {
  const lines: string[] = []
  for (const e of dict.values()) lines.push(`${e.display}\t${e.df}`)
  return lines.join('\n')
}

/** Обратная операция к {@link serializeTermDictionary}. */
export function parseTermDictionary(text: string): TermDictionary {
  const dict: TermDictionary = new Map()
  for (const line of text.split('\n')) {
    if (!line) continue
    const tab = line.lastIndexOf('\t')
    if (tab <= 0) continue
    const display = line.slice(0, tab)
    const df = Number(line.slice(tab + 1))
    if (!Number.isFinite(df) || df < 1) continue
    const key = foldKey(display)
    const prev = dict.get(key)
    if (!prev || prev.df < df) dict.set(key, { key, display, df })
  }
  return dict
}

// ------------------------------------------------------------- suggestions --

/** Исправление одного токена запроса. */
export interface TermCorrection {
  from: string
  to: string
  /** 0 — слово известно словарю; 0.5–2 — дистанция; Infinity — не исправлено. */
  cost: number
}

export interface FuzzySuggestOptions {
  /**
   * Поставщик кандидатов для токена (биграммный индекс и т.п.).
   * Без него словарь обходится целиком — на больших словарях это дорого.
   */
  candidates?: (key: string) => Iterable<TermDictionaryEntry>
}

export interface FuzzySuggestResult {
  tokens: TermCorrection[]
  /** Запрос с подставленными исправлениями. */
  correctedQuery: string
  /** Хотя бы один токен переписан (по ключу, не по поверхности). */
  changed: boolean
}

/**
 * Исправить опечатки запроса по словарю корпуса. Известные слова проходят как
 * есть; для неизвестных ищется ближайший термин по взвешенной дистанции.
 * Тай-брейк детерминирован: cost ↑, затем df ↓, затем key ↑ — иначе результат
 * зависел бы от порядка обхода Map (порядка выгрузки каталога).
 */
export function suggestCorrections(
  query: string,
  dict: TermDictionary,
  opts: FuzzySuggestOptions = {},
): FuzzySuggestResult {
  const tokens: TermCorrection[] = []
  let changed = false
  for (const tok of tokenize(query)) {
    if (tok.length < MIN_TERM_LEN) {
      tokens.push({ from: tok, to: tok, cost: 0 })
      continue
    }
    const key = foldKey(tok)
    const exact = dict.get(key)
    if (exact) {
      tokens.push({ from: tok, to: exact.display, cost: 0 })
      continue
    }
    const maxCost = maxCostFor(key)
    let best: TermDictionaryEntry | null = null
    let bestCost = Infinity
    const pool = opts.candidates ? opts.candidates(key) : dict.values()
    for (const e of pool) {
      if (Math.abs(e.key.length - key.length) > maxCost) continue
      const d = damerauLevenshtein(key, e.key)
      if (d > maxCost) continue
      if (
        d < bestCost ||
        (d === bestCost && best !== null && (e.df > best.df || (e.df === best.df && e.key < best.key)))
      ) {
        bestCost = d
        best = e
      }
    }
    if (best) {
      tokens.push({ from: tok, to: best.display, cost: bestCost })
      if (best.key !== key) changed = true
    } else {
      tokens.push({ from: tok, to: tok, cost: Infinity })
    }
  }
  return { tokens, correctedQuery: tokens.map((t) => t.to).join(' '), changed }
}

// ---------------------------------------------------------------- scoring ---

export type FuzzyRecord = {
  title: string
  aliases?: readonly string[]
}

export type FuzzyResult<T> = {
  record: T
  score: number
}

/** Подготовленный текст записи: свёрнутая строка + её слова (для DL по токенам). */
export type PreparedText = { full: string; words: string[] }

/** Свернуть и разобрать тексты записи один раз (кэшируйте результат по id). */
export function prepareTexts(texts: readonly string[]): PreparedText[] {
  return texts.map((text) => {
    const full = foldKey(text)
    return { full, words: tokenize(full) }
  })
}

/** Свернуть запрос в токены сопоставления. */
export function prepareQuery(query: string): string[] {
  return tokenize(foldKey(query))
}

function scoreTokenAgainst(token: string, text: PreparedText): number {
  if (!token) return 0
  if (text.full === token) return 1
  if (text.full.startsWith(token)) return 0.92
  if (text.full.includes(token)) return 0.8
  const maxCost = maxCostFor(token)
  let best = 0
  for (const word of text.words) {
    if (word === token) return 0.95
    if (word.startsWith(token)) {
      if (best < 0.85) best = 0.85
      continue
    }
    if (Math.abs(word.length - token.length) <= maxCost) {
      const d = damerauLevenshtein(token, word)
      if (d <= maxCost) {
        // 0.45..0.7 — выше подпоследовательности, ниже подстроки.
        const s = 0.7 - 0.25 * (d / maxCost)
        if (s > best) best = s
        continue
      }
    }
    // слабый хвост: подпоследовательность («nrt» в «naruto»)
    let cursor = 0
    let hits = 0
    for (const char of token) {
      const next = word.indexOf(char, cursor)
      if (next < 0) {
        hits = 0
        break
      }
      hits++
      cursor = next + 1
    }
    if (hits === token.length) {
      const s = 0.35 * (hits / Math.max(word.length, token.length))
      if (s > best) best = s
    }
  }
  return best
}

/**
 * Скор записи по токенам запроса: каждый токен обязан найтись хоть где-то
 * (min-агрегация), лучшее совпадение ищется по всем текстам записи.
 */
export function scorePrepared(texts: readonly PreparedText[], tokens: readonly string[]): number {
  if (!tokens.length) return 0
  let total = 0
  for (const token of tokens) {
    let best = 0
    for (const text of texts) {
      const s = scoreTokenAgainst(token, text)
      if (s > best) best = s
      if (best === 1) break
    }
    if (best === 0) return 0
    total = total === 0 ? best : Math.min(total, best)
  }
  return total
}

/**
 * Ранжирование массива записей по запросу (совместимый экспорт).
 * Для потоковой выдачи с дедупом и виртуальными страницами используйте
 * `createRankedSearchSource` из `accumulator.ts`.
 */
export function rankFuzzy<T extends FuzzyRecord>(records: readonly T[], query: string): FuzzyResult<T>[] {
  const tokens = prepareQuery(query)
  if (!tokens.length) return records.map((record) => ({ record, score: 0 }))
  return records
    .map((record) => ({
      record,
      score: scorePrepared(prepareTexts([record.title, ...(record.aliases ?? [])]), tokens),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
}

/**
 * @deprecated Наивный накопитель первой страницы: без дедупа, без глобальной
 * сортировки между порциями и без страниц p>1. Оставлен для совместимости;
 * его роль выполняет `createRankedSearchSource` (см. accumulator.ts).
 */
export async function collectFuzzyPage<T extends FuzzyRecord>(options: {
  query: string
  pageSize: number
  load: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string; hasNext: boolean }>
}): Promise<{ items: T[]; hasNext: boolean }> {
  const accepted: T[] = []
  let cursor: string | undefined
  let hasNext = true
  while (hasNext && accepted.length < options.pageSize) {
    const page = await options.load(cursor)
    accepted.push(...rankFuzzy(page.items, options.query).map((item) => item.record))
    hasNext = page.hasNext
    cursor = page.nextCursor
  }
  return { items: accepted.slice(0, options.pageSize), hasNext }
}
