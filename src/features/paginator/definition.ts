// Демо-фабрика пагинаторов (порт paginators.ts React-версии) — и она же
// ЕДИНЫЙ раздел «пагинатор + поиск»: источник, поиск источника и lib search
// больше не разложены по отдельным демо, а живут одним пагинатором с опциями
// панели (`src`, `srch`, `ls`), как на канонной странице shikimori.
//
// ОДИН пагинатор на способ хранения (адаптер/хранилище) — имя стабильно:
//   demo-url        — URL-адаптер: ?page, ?page.size, ?page.<key> (формат как у модалок)
//   demo-local-ls   — local-адаптер + localStorage (ключ pag:demo-local-ls)
//   demo-local-mem  — local-адаптер + память (сбрасывается при reload)
//
// Три источника у одного пагинатора (опция `src`):
//   products/photos — локальные данные демо (getItemsPage);
//   animes          — ЖИВОЙ каталог Shikimori: прямые запросы к его API через
//                     наш бэкенд (`/api/shikimori/animes`), без выгрузки и без
//                     локальной карты (канон SolidHono работал с дампом — решение
//                     владельца: этот путь не повторяем).
//
// Поиск — два независимых слоя (обе опции панели):
//   `srch` — РОДНОЙ поиск источника: `q` уезжает в API как `search`
//            (подстрока по названиям). Работает без lib search.
//   `ls`   — lib search поверх источника: перехватчик (fuzzy-ранжирование +
//            коррекция опечаток по словарю) подменяет выдачу на клиенте.
// Выключены оба → `q` до источника не доходит, список — обычный каталог.
import { getItemsPage } from '../../content/items'
import {
  SHIKIMORI_LIMIT_MAX,
  getAnimesPage,
  getShikimoriTerms,
  type AnimesPage,
} from '../../content/shikimori'
import {
  createLazyCorrector,
  createSearchInterceptor,
  reportSearchCorrection,
  searchQueryValidator,
  type QueryCorrector,
  type SearchCorrectionInfo,
  type SearchInterceptStats,
} from '$lib/search'
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
import { catalogTexts, type CatalogItem } from './item-views'

export type DemoStore = 'url' | 'local' | 'none'

/** Источник данных пагинатора (опция панели `src`). */
export type DemoSrc = 'products' | 'photos' | 'animes'
export const DEMO_SRCS: readonly DemoSrc[] = ['products', 'photos', 'animes']

/** Ключи потребителя, живущие в хранилище пагинатора (RestorableState.extra). */
export type DemoExtra = {
  /** Источник данных: товары, фото или живой каталог Shikimori. */
  src: DemoSrc
  /** Родной поиск источника (`q` → `search` в API). Выключен → запрос не применяется. */
  srch: boolean
  /** lib search: перехват источника (fuzzy + коррекция). Выключен → выдача источника как есть. */
  ls: boolean
  /** Текущий запрос; ключ `.q` адреса, `reloadKeys` сбрасывает выдачу на 1-ю страницу. */
  q: string
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
  /** Число колонок в раскладке columns: 'auto' | 2 | 3 | 4. */
  cols: DemoCols
  /** Авто-колонки: целевая ширина колонки, px. */
  colW: DemoColW
  /** Авто-колонки: допуск вписывания (сжать/растянуть), % от colW. */
  colFit: DemoColFit
}

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

/**
 * Размеры страницы панели. У живого Shikimori размер = `limit` запроса к API,
 * и он НЕ может превысить 50 (больше сервис молча режет до 50 — предел
 * зашит в `SHIKIMORI_LIMIT_MAX` и в разборе параметров эндпоинта).
 */
export const DEMO_PAGE_SIZES = [5, 10, 20, 40] as const

export const DEFAULT_DEMO_EXTRA: DemoExtra = {
  src: 'products',
  srch: true,
  ls: false,
  q: '',
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
  cols: 'auto',
  colW: 220,
  colFit: 25,
}

export const DEFAULT_DEMO_CONFIG: DemoConfig = {
  ...DEFAULT_DEMO_EXTRA,
  store: 'url',
  pageSize: 20,
}

/** Ключи extra, влияющие на ДАННЫЕ источника (смена → сброс + стр. 1). */
export const DEMO_RELOAD_KEYS = ['src', 'srch', 'ls', 'q', 'total'] as const

const oneOf =
  (...values: readonly string[]) =>
  (v: ExtraValue): boolean =>
    typeof v === 'string' && values.includes(v)
const bool = extraField('boolean')

/** Спецификация `?page.<key>` — ОДНА для validateSearch роута, адаптера и хоста (deny-safe). */
export const DEMO_EXTRA_SEARCH: ExtraSearchSpec = {
  src: extraField('text', oneOf(...DEMO_SRCS)),
  srch: bool,
  ls: bool,
  // Нормализация запроса — общая с lib search (управляющие → пробел, trim, обрезка).
  q: searchQueryValidator(120),
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
  cols: (v) => (v === 'auto' || v === 2 || v === 3 || v === 4 ? v : undefined),
  colW: extraField('number', (v) => v === 160 || v === 220 || v === 300 || v === 400),
  colFit: extraField('number', (v) => v === 0 || v === 10 || v === 25 || v === 50),
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

/** Текущий запрос из extra (`q`); пусто — сквозной проход, каталог как есть. */
export function demoQueryOf(extra: Extra | undefined): string {
  return typeof extra?.q === 'string' ? extra.q.trim() : ''
}

// ── Мост к живому источнику на сервере ─────────────────────────────────────
/**
 * На SSR тот же базовый источник обязан уметь отдать страницу каталога, не
 * сходя с сервера: снапшот страницы строится в лоадере (`initServerPaginator`),
 * а ходить оттуда в собственный HTTP-эндпоинт — лишний круг. Поэтому
 * server-only лоадер подставляет транспорт напрямую к `$lib/server/shikimori`
 * (там кэш, троттлинг и User-Agent); в браузере мост пуст, и источник идёт в
 * свой эндпоинт `/api/shikimori/animes`. Развилка в ОДНОМ месте — сама логика
 * страницы/перехвата/ошибок у источника одна на оба мира.
 */
export type LiveTransport = {
  fetchPage(query: { page: number; limit: number; search?: string }): Promise<AnimesPage>
}

let liveTransport: LiveTransport | null = null

/** Подставляет серверный транспорт живого источника (только из server-only кода). */
export function setLiveServerTransport(transport: LiveTransport | null): void {
  liveTransport = transport
}

/** Страница живого каталога: сервер — напрямую в API, браузер — через свой бэкенд. */
async function loadAnimePage(req: PageRequest, q: string): Promise<PageResponse<CatalogItem>> {
  const query = { page: req.page, limit: req.pageSize, ...(q ? { search: q } : {}) }
  const res = liveTransport
    ? await liveTransport.fetchPage(query)
    : await getAnimesPage({ ...query, signal: req.signal })
  // Числа страниц Shikimori API не отдаёт: только «страница пришла полной».
  return { items: res.items, hasNext: res.hasNext }
}

// ── Каналы демо-панели: статистика перехвата (подпись коррекции — в реестре lib search) ──

type StatsListener = (stats: SearchInterceptStats | null) => void
const statsListeners = new Map<string, Set<StatsListener>>()
const lastStats = new Map<string, SearchInterceptStats | null>()

export function getInterceptStats(name: string): SearchInterceptStats | null {
  return lastStats.get(name) ?? null
}

export function onInterceptStats(name: string, listener: StatsListener): () => void {
  const listeners = statsListeners.get(name) ?? new Set<StatsListener>()
  statsListeners.set(name, listeners)
  listeners.add(listener)
  listener(getInterceptStats(name))
  return () => {
    listeners.delete(listener)
    if (!listeners.size) statsListeners.delete(name)
  }
}

function publishStats(name: string, stats: SearchInterceptStats | null): void {
  lastStats.set(name, stats)
  for (const listener of statsListeners.get(name) ?? []) listener(stats)
}

/**
 * БАЗОВЫЙ источник страниц: «дай страницу N размера M» у выбранного источника.
 *
 * - products/photos — локальные данные демо, `q` не понимают (родного поиска
 *   нет; поиск по ним возможен только слоем lib search);
 * - animes — Shikimori API: `q` уезжает ОТДЕЛЬНЫМ полем `search` (не в
 *   фильтры), номер страницы — `page`, размер — `limit` (≤ 50).
 */
const baseSource: Source<CatalogItem> = async (req: PageRequest): Promise<PageResponse<CatalogItem>> => {
  const cfg = demoExtraOf(req.extra ?? {})
  // Опция `srch` — про РОДНОЙ поиск источника: выключена → запрос до API не
  // доходит (каталог как есть), но сам `q` остаётся в extra и доступен слою
  // lib search — тот тогда сканирует каталог БЕЗ сужения источника.
  if (cfg.src === 'animes') return loadAnimePage(req, cfg.srch ? demoQueryOf(req.extra) : '')
  const r = await getItemsPage({ kind: cfg.src, page: req.page, pageSize: req.pageSize })
  if (cfg.total) {
    return { items: r.items, totalItems: r.totalItems, totalPages: r.totalPages }
  }
  return { items: r.items, hasNext: req.page * req.pageSize < (r.totalItems ?? 0) }
}

/** Словарь коррекции собирает backend одной пачкой (живые страницы популярности). */
const loadCorrector = createLazyCorrector(() => getShikimoriTerms())

/**
 * Перехватчик lib search — ОДИН НА ИМЯ пагинатора (у перехватчика своё
 * состояние: буфер, водяной знак, «замороженные» страницы; делить его между
 * хранилищами нельзя) и всегда в цепочке: работает только при `ls` и непустом
 * `q`, иначе — сквозной проход к базовому источнику (пустой запрос, SSR/no-JS,
 * выключенный тумблер дают выдачу источника как есть).
 *
 * Fuzzy — метод сопоставления, страницы добирает lib search (батчи). Коррекция
 * опечаток — по словарю Shikimori, поэтому включается только для этого
 * источника; товары/фото ранжируются без коррекции (fallback-сканирование).
 */
function makeIntercepted(name: string, srcOf: () => DemoSrc): Source<CatalogItem> {
  return createSearchInterceptor<CatalogItem>({
    source: baseSource,
    id: (record) => String(record.id),
    // Батч = предел выдачи Shikimori за один запрос: больше сервис молча режет
    // до 50, и «неполная страница» врёт про исчерпание каталога. Исчерпание
    // перехватчик читает из `hasNext` источника, а не из длины батча.
    batchSize: SHIKIMORI_LIMIT_MAX,
    // Тексты записи — общий хелпер вьюх: для Shikimori это романдзи + русское
    // название (и то и другое человек видит в списке и набирает в поиске).
    texts: catalogTexts,
    correct: async (query): Promise<SearchCorrectionInfo | null> => {
      // Fuzzy/коррекция НИКОГДА не выполняются на сервере, и словарь есть
      // только у Shikimori: товары/фото ранжируются без коррекции.
      if (import.meta.env?.SSR) return null
      if (srcOf() !== 'animes') return null
      const corrector: QueryCorrector | null = await loadCorrector()
      if (!corrector) return null
      const result = corrector.correct(query)
      const corrected = result.correctedQuery.trim()
      if (!corrected) return null
      return { query, corrected, changed: result.changed }
    },
    // Подпись «искали X → показываем Y» кладётся в реестр lib search — её читает
    // `useSearchCorrection(name)` из `$lib/search/svelte` (имя = имя пагинатора).
    onCorrection: (info) => reportSearchCorrection(name, info),
    onStats: (stats) => publishStats(name, stats),
  })
}

/**
 * Комбинированный источник пагинатора — матрица опций панели:
 *
 *   srch  ls   что происходит
 *   ────  ───  ─────────────────────────────────────────────────────────────
 *   вкл   выкл родной поиск источника: `q` → `search` в API. lib search не нужен.
 *   вкл   вкл  lib search поверх родного поиска: сужение исправленным запросом
 *              (батчи), fuzzy-ранжирование, коррекция опечаток.
 *   выкл  вкл  lib search БЕЗ родного поиска: источник отдаёт каталог как есть,
 *              перехватчик сканирует его без сужения (медленнее, но находит).
 *   выкл  выкл поиска нет вовсе: обычный каталог.
 *
 * Перехватчик всегда в цепочке (как у канона): при пустом `q` он и сам уходит
 * в сквозной проход.
 */
function makeSource(name: string): Source<CatalogItem> {
  // Текущий источник нужен корректору словаря: он осмыслен только для Shikimori.
  let currentSrc: DemoSrc = DEFAULT_DEMO_EXTRA.src
  const intercepted = makeIntercepted(name, () => currentSrc)
  return (req: PageRequest): Promise<PageResponse<CatalogItem>> => {
    const cfg = demoExtraOf(req.extra ?? {})
    currentSrc = cfg.src
    if (!cfg.ls) {
      publishStats(name, null)
      return baseSource(req)
    }
    return intercepted(req)
  }
}

/** Get-or-create: зарегистрировать пагинатор под способ хранения и вернуть его имя. */
export function ensureDemoPaginator(store: DemoStore): string {
  const name = demoName(store)
  if (hasPaginator(name)) return name
  if (store === 'url') {
    definePaginator<CatalogItem>({
      name,
      pageSize: DEFAULT_DEMO_CONFIG.pageSize,
      reloadKeys: DEMO_RELOAD_KEYS,
      adapter: createUrlAdapter<CatalogItem>({
        name,
        source: makeSource(name),
        pageSize: DEFAULT_DEMO_CONFIG.pageSize,
        pageSizes: DEMO_PAGE_SIZES,
        pageParam: 'page',
        extraSearch: DEMO_EXTRA_SEARCH,
        extraDefaults: DEFAULT_DEMO_EXTRA,
      }),
    })
  } else {
    definePaginator<CatalogItem>({
      name,
      source: makeSource(name),
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

const gallerySource: Source<CatalogItem> = async ({ page, pageSize }: PageRequest) => {
  const r = await getItemsPage({ kind: 'photos', page, pageSize })
  return { items: r.items, totalItems: r.totalItems, totalPages: r.totalPages }
}

export function ensureGalleryPaginator(): string {
  if (hasPaginator(GALLERY_NAME)) return GALLERY_NAME
  definePaginator<CatalogItem>({
    name: GALLERY_NAME,
    pageSize: 12,
    adapter: createUrlAdapter<CatalogItem>({
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
