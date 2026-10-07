// Демо-фабрика пагинаторов (порт paginators.ts React-версии).
//
// ОДИН пагинатор на способ хранения (адаптер/хранилище) — имя стабильно:
//   demo-url        — URL-адаптер: ?page, ?page.size, ?page.<key> (формат как у модалок)
//   demo-local-ls   — local-адаптер + localStorage (ключ pag:demo-local-ls)
//   demo-local-mem  — local-адаптер + память (сбрасывается при reload)
//
// Раздел ОДИН и на каталог, и на поиск (как страница Shikimori в исходнике):
// источник выбирается опцией панели (`extra.kind`) — товары, фото или каталог
// Shikimori; поиск подключается туда же надстройкой lib search:
//   extra.search=false — поиска нет (поля нет, `q` до источника не доходит);
//   extra.fuzzy=false  — родной поиск ИСТОЧНИКА (у Shikimori — подстрока на
//                        нашем бэкенде), lib search в цепочку не встаёт;
//   оба включены       — перехват источника lib search (fuzzy на клиенте).
import {
  createLazyCorrector,
  type QueryCorrector,
} from '$lib/search/dictionary'
import {
  createSearchInterceptor,
  type SearchCorrectionInfo,
  type SearchInterceptStats,
  type SearchInterceptorOptions,
} from '$lib/search/accumulator'
import {
  reportSearchCorrection,
  searchQueryValidator,
} from '$lib/search/registry'
import {
  createLocalStorageStorage,
  createUrlAdapter,
  definePaginator,
  extraField,
  hasPaginator,
  type EdgeTrigger,
  type Extra,
  type ExtraSearchSpec,
  type ExtraValue,
  type PageRequest,
  type PageResponse,
  type PrependBehavior,
  type Source,
} from '$lib/paginate'
import { getItemsPage, type DemoEntry, type DemoItem, type ItemKind } from '../../content/items'
import { ANIME_MAX_QUERY, loadAnimePage } from '../../content/anime'
import { isAnimeRecord } from './item-views'

export type DemoStore = 'url' | 'local' | 'none'
/** Источник данных пагинатора: демо-наборы или каталог Shikimori. */
export type DemoKind = ItemKind | 'anime'

/** Ключи потребителя, живущие в хранилище пагинатора (RestorableState.extra). */
export type DemoExtra = {
  /** Тип содержимого (источник): товары, фото или аниме (Shikimori API). */
  kind: DemoKind
  /** Раскладка (UI): список или 4 колонки round-robin. */
  layout: 'list' | 'columns'
  /** accumulate — страницы складываются (подгрузка); single — классическая смена (REPLACE). */
  mode: 'accumulate' | 'single'
  /** Известное число страниц: источник отдаёт totals → номерные кнопки; иначе только стрелки (R12). */
  total: boolean
  /** Скелетоны при загрузке (UI). */
  skel: boolean
  /** Триггеры краёв (см. PaginatorHostProps.topTrigger/bottomTrigger); 'off' = край выключен. */
  topTrigger: EdgeTrigger
  bottomTrigger: EdgeTrigger
  /** Зоны краёв: 'edge' | '20%' | '40%' | '200px'. */
  topZone: DemoZone
  bottomZone: DemoZone
  /** Позиция при подгрузке сверху (см. PaginatorHostProps.prependBehavior). */
  prepend: PrependBehavior
  /** Плавающий индикатор загрузки (UI-компонент). */
  ind: boolean
  /** Минимальное время показа скелетонов подгрузки, мс (0 — без задержки). */
  pend: DemoHoldMs
  /** Число колонок в раскладке columns: 'auto' | 2 | 3 | 4. */
  cols: DemoCols
  /** Авто-колонки: целевая ширина колонки, px. */
  colW: DemoColW
  /** Авто-колонки: допуск вписывания (сжать/растянуть), % от colW. */
  colFit: DemoColFit
  /** Запрос поиска (`?page.q`) — ключ extra пагинатора, как у lib search. */
  q: string
  /** Поиск включён: поле запроса на странице и учёт `q` источником. */
  search: boolean
  /** lib search включён: fuzzy-перехват источника; иначе — родной поиск источника. */
  fuzzy: boolean
}

export type DemoHoldMs = 0 | 200 | 300 | 600 | 900
export const DEMO_HOLD_MS: readonly DemoHoldMs[] = [0, 200, 300, 600, 900]

export type DemoColW = 160 | 220 | 300 | 400
export type DemoColFit = 0 | 10 | 25 | 50

export type DemoZone = 'edge' | '20%' | '40%' | '200px'
export type DemoCols = 'auto' | 2 | 3 | 4
export const DEMO_ZONES: readonly DemoZone[] = ['edge', '20%', '40%', '200px']

export type DemoConfig = DemoExtra & {
  /** Где живут настройки и указатель: URL / localStorage / память. */
  store: DemoStore
  pageSize: number
}

export const DEMO_PAGE_SIZES = [5, 10, 20] as const

export const DEFAULT_DEMO_EXTRA: DemoExtra = {
  kind: 'products',
  layout: 'list',
  mode: 'accumulate',
  total: true,
  skel: true,
  topTrigger: 'direction',
  bottomTrigger: 'direction',
  topZone: '40%',
  bottomZone: '40%',
  prepend: 'auto',
  ind: true,
  pend: 300,
  cols: 'auto',
  colW: 220,
  colFit: 25,
  q: '',
  search: true,
  fuzzy: true,
}

export const DEFAULT_DEMO_CONFIG: DemoConfig = {
  ...DEFAULT_DEMO_EXTRA,
  store: 'url',
  pageSize: 20,
}

/**
 * Ключи extra, влияющие на ДАННЫЕ источника (смена → сброс + стр. 1):
 * `q` — как в lib search (reloadKeys запроса), `search`/`fuzzy` меняют контур
 * поиска, `kind`/`total` — сам источник и форму его ответа.
 */
export const DEMO_RELOAD_KEYS = ['kind', 'total', 'q', 'search', 'fuzzy'] as const

const oneOf =
  (...values: readonly string[]) =>
  (v: ExtraValue): boolean =>
    typeof v === 'string' && values.includes(v)
const bool = extraField('boolean')

/** Спецификация `?page.<key>` — ОДНА для validateSearch роута, адаптера и хоста (deny-safe). */
export const DEMO_EXTRA_SEARCH: ExtraSearchSpec = {
  kind: extraField('text', oneOf('products', 'photos', 'anime')),
  layout: extraField('text', oneOf('list', 'columns')),
  mode: extraField('text', oneOf('accumulate', 'single')),
  total: bool,
  skel: bool,
  topTrigger: extraField('text', oneOf('off', 'direction', 'edge', 'chat', 'manual')),
  bottomTrigger: extraField('text', oneOf('off', 'direction', 'edge', 'chat', 'manual')),
  topZone: extraField('text', oneOf(...DEMO_ZONES)),
  bottomZone: extraField('text', oneOf(...DEMO_ZONES)),
  prepend: extraField('text', oneOf('auto', 'native', 'js')),
  ind: bool,
  pend: extraField('number', (v) => DEMO_HOLD_MS.includes(v as DemoHoldMs)),
  cols: (v) => (v === 'auto' || v === 2 || v === 3 || v === 4 ? v : undefined),
  colW: extraField('number', (v) => v === 160 || v === 220 || v === 300 || v === 400),
  colFit: extraField('number', (v) => v === 0 || v === 10 || v === 25 || v === 50),
  // Запрос — тот же валидатор, что у `defineSearch`: сырой q из адреса
  // нормализуется централизованно (управляющие, длина), пустой = «ключа нет».
  q: searchQueryValidator(ANIME_MAX_QUERY),
  search: bool,
  fuzzy: bool,
}

/** extra из state → типизированный DemoExtra (мусор/отсутствие → дефолт). */
export function demoExtraOf(extra: Extra): DemoExtra {
  const out: DemoExtra = { ...DEFAULT_DEMO_EXTRA }
  for (const key of Object.keys(DEMO_EXTRA_SEARCH) as (keyof DemoExtra)[]) {
    const v = DEMO_EXTRA_SEARCH[key](extra[key] ?? null)
    if (v !== undefined) (out as Record<string, unknown>)[key] = v
  }
  return out
}

export function demoName(store: DemoStore): string {
  return store === 'url' ? 'demo-url' : store === 'local' ? 'demo-local-ls' : 'demo-local-mem'
}

// ── Каталог Shikimori: родной поиск бэкенда и словарь для fuzzy ─────────────

/**
 * Ленивый корректор опечаток (lib search): артефакт `display\tdf` собирает наш
 * бэкенд из образца популярного каталога — fuzzy-сопоставление исполняется
 * только здесь, на клиенте, и никогда на сервере.
 */
const loadAnimeCorrector: () => Promise<QueryCorrector | null> = createLazyCorrector(async () => {
  const response = await fetch('/api/anime/terms')
  return response.ok ? response.text() : ''
})

/**
 * Коррекция запроса для каталога Shikimori. Если словарь недоступен или
 * термина рядом нет — отдаём «исправлять нечего» с СЫРЫМ запросом: контур
 * становится серверным сужением (родной поиск), а не слепым сканированием
 * живого API (демо-источник товаров/фото сканируется без опаски — там данные
 * локальные, счёт идёт на единицы запросов).
 */
async function correctAnimeQuery(query: string): Promise<SearchCorrectionInfo | null> {
  if (typeof window === 'undefined') return null // fuzzy никогда не на сервере
  const corrector = await loadAnimeCorrector()
  const result = corrector?.correct(query)
  const corrected = result?.correctedQuery.trim()
  if (!result || !corrected) return { query, corrected: query, changed: false }
  return { query, corrected, changed: result.changed }
}

// ── Базовый источник: «дай страницу N размера M» у выбранного источника ─────

/** Поля ранжирования lib search: у аниме — название и синонимы, у демо — подпись. */
function searchTexts(record: DemoEntry): readonly string[] {
  if (isAnimeRecord(record)) return [record.title, ...record.aliases]
  if ('caption' in record) return [String(record.caption ?? `Photo ${record.id}`)]
  return [String(record.title ?? record.id)]
}

const baseSource: Source<DemoEntry> = async ({
  page,
  pageSize,
  extra,
  signal,
}: PageRequest): Promise<PageResponse<DemoEntry>> => {
  const cfg = demoExtraOf(extra ?? {})
  // Поиск выключен опцией панели — запрос до источника не доходит вообще.
  const q = cfg.search ? String(extra?.q ?? '').trim() : ''
  if (cfg.kind === 'anime') {
    // Каталог Shikimori: с `q` сервер сужает выдачу подстрокой (родной поиск),
    // без `q` — обычная страница каталога. `totalItems` API не отдаёт → стрелки.
    const result = await loadAnimePage({ page, limit: pageSize, q: q || undefined }, { signal })
    return { items: result.items, hasNext: result.hasNext }
  }
  const r = await getItemsPage({ kind: cfg.kind, page, pageSize })
  if (cfg.total) {
    return { items: r.items, totalItems: r.totalItems, totalPages: r.totalPages }
  }
  return { items: r.items, hasNext: page * pageSize < (r.totalItems ?? 0) }
}

// ── Перехват источника lib search (по опции панели) ─────────────────────────

/**
 * Границы добора у живого API жёстче локальных: батч — потолок самого API
 * (50), бюджет вызова — считанные запросы, чтобы «поиск» не превращался в
 * скачивание всего каталога Shikimori.
 */
const ANIME_INTERCEPT = {
  batchSize: 50,
  maxBatchesPerCall: 2,
  maxBatchesDeepLink: 4,
  parallelBatches: 2,
} as const

/** Перехватчик на пару (имя пагинатора, источник): у каждого свой буфер ранжирования. */
const interceptors = new Map<string, Source<DemoEntry>>()

function interceptorFor(name: string, kind: DemoKind): Source<DemoEntry> {
  const key = `${name}\u0000${kind}`
  const cached = interceptors.get(key)
  if (cached) return cached
  const options: SearchInterceptorOptions<DemoEntry> = {
    source: baseSource,
    id: (record) => String(record.id),
    texts: searchTexts,
    onCorrection: (info) => reportSearchCorrection(name, info),
    onStats: (stats) => reportSearchStats(name, stats),
    ...(kind === 'anime' ? ANIME_INTERCEPT : {}),
  }
  if (kind === 'anime') options.correct = correctAnimeQuery
  const source = createSearchInterceptor(options)
  interceptors.set(key, source)
  return source
}

/**
 * Источник демо-пагинатора: базовый источник плюс (по опциям панели) перехват
 * lib search. Опции живут в extra пагинатора, поэтому восстанавливаются из
 * адреса/localStorage/памяти вместе со страницей.
 */
function demoSourceFor(name: string): Source<DemoEntry> {
  return (req) => {
    const cfg = demoExtraOf(req.extra ?? {})
    if (!cfg.search || !cfg.fuzzy) {
      // Перехвата в цепочке нет: живые счётчики гасим, а подпись коррекции НЕ
      // трогаем — панель прячет её по флагам, а реестр lib search обновится сам
      // (перехватчик докладывает коррекцию один раз на аккумулятор, и после
      // возврата флага тот же запрос повторно её не прислал бы).
      if (getSearchStats(name)) reportSearchStats(name, null)
      return baseSource(req)
    }
    return interceptorFor(name, cfg.kind)(req)
  }
}

// ── Живая статистика перехвата и подпись коррекции для демо-панели ──────────

export type DemoSearchStats = SearchInterceptStats | null

const statsById = new Map<string, DemoSearchStats>()
const statsListeners = new Map<string, Set<(stats: DemoSearchStats) => void>>()

/** Живая статистика перехвата выбранного пагинатора (null — перехват неактивен). */
export function getSearchStats(name: string): DemoSearchStats {
  return statsById.get(name) ?? null
}

export function onSearchStats(name: string, listener: (stats: DemoSearchStats) => void): () => void {
  let set = statsListeners.get(name)
  if (!set) {
    set = new Set()
    statsListeners.set(name, set)
  }
  set.add(listener)
  return () => set.delete(listener)
}

function reportSearchStats(name: string, stats: DemoSearchStats): void {
  statsById.set(name, stats)
  for (const listener of statsListeners.get(name) ?? []) listener(stats)
}

// ── Регистрация пагинаторов ─────────────────────────────────────────────────

/** Get-or-create: зарегистрировать пагинатор под способ хранения и вернуть его имя. */
export function ensureDemoPaginator(store: DemoStore): string {
  const name = demoName(store)
  if (hasPaginator(name)) return name
  if (store === 'url') {
    definePaginator<DemoEntry>({
      name,
      pageSize: DEFAULT_DEMO_CONFIG.pageSize,
      reloadKeys: DEMO_RELOAD_KEYS,
      adapter: createUrlAdapter<DemoEntry>({
        name,
        source: demoSourceFor(name),
        pageSize: DEFAULT_DEMO_CONFIG.pageSize,
        pageSizes: DEMO_PAGE_SIZES,
        pageParam: 'page',
        extraSearch: DEMO_EXTRA_SEARCH,
        extraDefaults: DEFAULT_DEMO_EXTRA,
      }),
    })
  } else {
    definePaginator<DemoEntry>({
      name,
      source: demoSourceFor(name),
      pageSize: DEFAULT_DEMO_CONFIG.pageSize,
      reloadKeys: DEMO_RELOAD_KEYS,
      storage: store === 'local' ? createLocalStorageStorage() : undefined,
    })
  }
  return name
}

// ── Второй URL-пагинатор на той же странице: галерея под своим префиксом ?gallery.* ─────
export const GALLERY_NAME = 'demo-gallery'
export const GALLERY_PAGE_PARAM = 'gallery'
export const GALLERY_PAGE_SIZES = [6, 12, 24] as const
export type GalleryExtra = { cols: 'auto' | 2 | 3 }
export const DEFAULT_GALLERY_EXTRA: GalleryExtra = { cols: 'auto' }
export const GALLERY_EXTRA_SEARCH: ExtraSearchSpec = {
  cols: (v) => (v === 'auto' || v === 2 || v === 3 ? v : undefined),
}
export function galleryExtraOf(extra: Extra): GalleryExtra {
  const cols = GALLERY_EXTRA_SEARCH.cols(extra.cols ?? null)
  return { cols: (cols as GalleryExtra['cols'] | undefined) ?? 'auto' }
}

const gallerySource: Source<DemoItem> = async ({ page, pageSize }: PageRequest) => {
  const r = await getItemsPage({ kind: 'photos', page, pageSize })
  return { items: r.items, totalItems: r.totalItems, totalPages: r.totalPages }
}

export function ensureGalleryPaginator(): string {
  if (hasPaginator(GALLERY_NAME)) return GALLERY_NAME
  definePaginator<DemoItem>({
    name: GALLERY_NAME,
    pageSize: 12,
    adapter: createUrlAdapter<DemoItem>({
      name: GALLERY_NAME,
      source: gallerySource,
      pageSize: 12,
      pageSizes: GALLERY_PAGE_SIZES,
      pageParam: GALLERY_PAGE_PARAM,
      extraSearch: GALLERY_EXTRA_SEARCH,
      extraDefaults: DEFAULT_GALLERY_EXTRA,
    }),
  })
  return GALLERY_NAME
}
