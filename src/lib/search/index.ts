// Публичная поверхность lib search. Serverless-часть (fuzzy, dictionary,
// accumulator) изоморфна; хук подписи коррекции — Svelte-слой
// (`$lib/search/svelte`, реэкспорт ниже). `./solid.tsx` — референс исходника,
// в баррель не входит (как `$lib/paginate/solid`): иначе solid-js попадал бы
// в клиентскую сборку SvelteKit.
export type { SearchConfig, SearchInstance } from './types'
export { withSearch, type WithSearchOptions } from './source'
export {
  defineSearch,
  hasSearch,
  getSearch,
  searchAddressSpec,
  searchQueryValidator,
  reportSearchCorrection,
  getSearchCorrection,
  onSearchCorrection,
  reportSearchStats,
  getSearchStats,
  onSearchStats,
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
