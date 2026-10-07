// Публичная поверхность lib search — framework-neutral часть: реестр, действия,
// перехватчик источника и изоморфное fuzzy-ядро. Всё здесь собирается и
// тестируется без единого фреймворка (тот же принцип, что у lib/paginate:
// ядро в `$lib/search`, обвязка — в `$lib/search/svelte`).
//
// Хук `useSearchCorrection` (подпись коррекции) живёт в Svelte-входе
// `$lib/search/svelte` и отсюда НЕ реэкспортируется: импорт `$lib/search`
// должен оставаться возможным из node-тестов, а `.svelte.ts`-обвязка тянет
// компилятор Svelte.
export type { SearchConfig, SearchInstance } from './types'
export {
  defineSearch,
  hasSearch,
  getSearch,
  searchAddressSpec,
  searchQueryValidator,
  reportSearchCorrection,
  getSearchCorrection,
  onSearchCorrection,
  resetSearchRegistry,
} from './registry'
export { setSearchQuery, clearSearchQuery, resyncSearch, normalizeSearchQuery } from './core'
export { reportSearchStats, getSearchStats, onSearchStats, resetSearchStats } from './stats'
export {
  withLibSearch,
  createAccumulatingSource,
  DEFAULT_FUZZY_BATCH,
  type SearchInterceptorOptions,
  type LibSearchOptions,
  type SearchCorrectionInfo,
  type SearchInterceptStats,
} from './accumulator'
export {
  foldKey,
  tokenize,
  damerauLevenshtein,
  substitutionCost,
  maxCostFor,
  buildTermDictionary,
  serializeTermDictionary,
  parseTermDictionary,
  suggestCorrections,
  prepareTexts,
  prepareQuery,
  scorePrepared,
  rankFuzzy,
  collectFuzzyPage,
  MIN_TERM_LEN,
  type TermDictionary,
  type TermDictionaryEntry,
  type TermCorrection,
  type FuzzySuggestOptions,
  type FuzzySuggestResult,
  type PreparedText,
  type FuzzyRecord,
  type FuzzyResult,
} from './fuzzy'
export { createQueryCorrector, createLazyCorrector, type QueryCorrector } from './dictionary'
