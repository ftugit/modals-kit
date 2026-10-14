/**
 * Клиентская сторона словаря корпуса: разбор артефакта `display\tdf`,
 * биграммный инвертированный индекс кандидатов и корректор запроса.
 *
 * Артефакт собирает сервер (он же корпус и хранит), но fuzzy-сопоставление
 * выполняется только здесь, на клиенте. Наивный полный обход словаря стоит
 * десятки миллисекунд на токен; биграммный индекс сводит выбор кандидатов к
 * единицам миллисекунд при потере полноты <1 п.п. (замер в решении 2026-09-29).
 */
import {
  MIN_TERM_LEN,
  maxCostFor,
  parseTermDictionary,
  suggestCorrections,
  type FuzzySuggestResult,
  type TermDictionary,
  type TermDictionaryEntry,
} from './fuzzy'

function bigramsOf(key: string): string[] {
  if (key.length < 2) return [key]
  const out: string[] = []
  for (let i = 0; i < key.length - 1; i++) out.push(key.slice(i, i + 2))
  return out
}

export type QueryCorrector = {
  dictionary: TermDictionary
  correct(query: string): FuzzySuggestResult
}

/** Сколько кандидатов максимум отдаёт биграммный индекс на токен. */
const CANDIDATE_CAP = 300

/**
 * Построить корректор из текста артефакта (`display\tdf` построчно).
 * Ключи пересчитываются через foldKey при загрузке — артефакт не зависит от
 * версии таблицы гомоглифов на клиенте.
 */
export function createQueryCorrector(artifact: string): QueryCorrector {
  const dictionary = parseTermDictionary(artifact)
  // биграмма → термины словаря, в которых она встречается
  const index = new Map<string, TermDictionaryEntry[]>()
  for (const entry of dictionary.values()) {
    for (const bigram of new Set(bigramsOf(entry.key))) {
      const bucket = index.get(bigram)
      if (bucket) bucket.push(entry)
      else index.set(bigram, [entry])
    }
  }

  const candidates = (key: string): Iterable<TermDictionaryEntry> => {
    if (key.length < MIN_TERM_LEN) return []
    const maxCost = maxCostFor(key)
    const counts = new Map<TermDictionaryEntry, number>()
    for (const bigram of new Set(bigramsOf(key))) {
      const bucket = index.get(bigram)
      if (!bucket) continue
      for (const entry of bucket) {
        if (Math.abs(entry.key.length - key.length) > maxCost) continue
        counts.set(entry, (counts.get(entry) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CANDIDATE_CAP)
      .map(([entry]) => entry)
  }

  return {
    dictionary,
    correct: (query) => suggestCorrections(query, dictionary, { candidates }),
  }
}

/**
 * Ленивая загрузка корректора: один in-flight на загрузчик, отказ не кэшируется
 * (артефакт может появиться позже). Использовать только на клиенте.
 */
export function createLazyCorrector(load: () => Promise<string>): () => Promise<QueryCorrector | null> {
  let ready: QueryCorrector | null = null
  let inflight: Promise<QueryCorrector | null> | null = null
  return () => {
    if (ready) return Promise.resolve(ready)
    inflight ??= load()
      .then((text) => {
        ready = createQueryCorrector(text)
        return ready
      })
      .catch(() => null)
      .finally(() => {
        inflight = null
      })
    return inflight
  }
}
