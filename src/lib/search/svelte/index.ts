// Svelte 5 adapter entrypoint lib search — аналог `$lib/paginate/svelte`:
// ядро остаётся чистым, всё реактивное и разметочное живёт здесь.
export { useSearchCorrection, type SearchCorrectionAccessor } from './correction.svelte'
export { useSearchStats, type SearchStatsAccessor } from './stats.svelte'
