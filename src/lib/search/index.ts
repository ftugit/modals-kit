// Публичная поверхность lib search. Serverless-часть (fuzzy, dictionary,
// accumulator) изоморфна; хуки подписи коррекции — по слоям фреймворков:
// `$lib/search/svelte` (порт) и `./solid.tsx` (референс исходника).
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
export {
  createAccumulatingSource,
  createSearchInterceptor,
  type SearchInterceptorOptions,
  type SearchFuzzyOptions,
  type SearchCorrectionInfo,
  type SearchInterceptStats,
} from './accumulator'
export {
  foldKey,
  tokenize,
  damerauLevenshtein,
  buildTermDictionary,
  serializeTermDictionary,
  parseTermDictionary,
  suggestCorrections,
  rankFuzzy,
  collectFuzzyPage,
  type TermDictionary,
  type TermDictionaryEntry,
  type FuzzySuggestResult,
} from './fuzzy'
export { createQueryCorrector, createLazyCorrector, type QueryCorrector } from './dictionary'
