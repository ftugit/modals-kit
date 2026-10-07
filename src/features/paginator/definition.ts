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
  reportSearchCorrection,
  searchQueryValidator,
  withLibSearch,
  type SearchCorrectionInfo,
  type SearchInterceptStats,
} from '$lib/search'
import {
  composeSources,
  createLocalStorageStorage,
  createUrlAdapter,
  definePaginator,
  defineSource,
  extraField,
  hasPaginator,
  withSearchGate,
  withTotalsGate,
  type AdaptedSource,
  type EdgeTrigger,
  type Extra,
  type ExtraSearchSpec,
  type ExtraValue,
  type PageResponse,
  type PrependBehavior,
  type SourceLook,
  type SourceRecordSpec,
} from '$lib/paginate'
import { catalogTexts, catalogTitle, type CatalogItem } from './item-views'

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
async function loadAnimePage(look: SourceLook, q: string): Promise<PageResponse<CatalogItem>> {
  const query = { page: look.page, limit: look.pageSize, ...(q ? { search: q } : {}) }
  const res = liveTransport
    ? await liveTransport.fetchPage(query)
    : await getAnimesPage({ ...query, signal: look.signal })
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
 * Паспорт записи каталога — ОДИН на все три источника демо: как читать любую
 * запись (id, заголовок, тексты) знает слой источника, а не потребитель. По
 * нему lib/search ранжирует и дедуплицирует, а вьюхи берут заголовки.
 */
const catalogRecord: SourceRecordSpec<CatalogItem> = {
  id: (item) => String(item.id),
  title: catalogTitle,
  texts: catalogTexts,
}

/**
 * Локальный источник демо.
 *
 * Товары умеют искать по названию: поиск реализован в самих данных
 * (`queryItemsPage` сужает корпус до пагинации), а наличие возможности
 * объявляет СПЕКА источника (`search`), не потребитель и не роут. Сканирование
 * разрешено (`scan`) — поверх работает lib/search (fuzzy по названию).
 *
 * Фото — «просто данные»: ни `search`, ни `scan`, ни фильтров. Возможностей нет
 * → панель гасит опции поиска и поле запроса (честное «искать нечем»).
 */
function createLocalItemsSource(kind: 'products' | 'photos'): AdaptedSource<CatalogItem> {
  const searchable = kind === 'products'
  return defineSource<CatalogItem>({
    name: kind,
    record: catalogRecord,
    ...(searchable ? { search: { minLength: 2 }, scan: {} } : {}),
    totals: true,
    data: async ({ page, pageSize, signal }, input) => {
      const r = await getItemsPage({ kind, page, pageSize, q: input.q, signal })
      return {
        items: r.items,
        totalItems: r.totalItems,
        totalPages: r.totalPages,
        hasNext: page * pageSize < (r.totalItems ?? 0),
      }
    },
  })
}

/**
 * Живой каталог Shikimori как источник: родной поиск (`q` уезжает ОТДЕЛЬНЫМ
 * полем `search`, не в фильтры), разрешение сканирования (лимит выдачи за один
 * запрос = размер батча lib/search: больше сервис молча режет до 50) и словарь
 * терминов для коррекции опечаток. Totals Shikimori не отдаёт — номерной
 * навигации у него нет (R12: только стрелки).
 *
 * Тумблер `srch` — декоратор `withSearchGate`: при выключенном родном поиске
 * источник получает пустой `q` (каталог как есть), но сам `q` остаётся в extra
 * и доступен lib/search — сканирование без сужения источником.
 */
function createAnimesSource(): AdaptedSource<CatalogItem> {
  return defineSource<CatalogItem>({
    name: 'animes',
    record: catalogRecord,
    search: { minLength: 2 },
    scan: { batchSize: SHIKIMORI_LIMIT_MAX },
    totals: false,
    dictionary: () => getShikimoriTerms(),
    data: (look, input) => loadAnimePage(look, input.q),
  }).with(withSearchGate({ gate: 'srch' }))
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
 * Кто что объявляет:
 *  • `srch` гаснет у источников без родного поиска (см. `capabilities.search`);
 *  • `ls` — подключение lib/search (декоратор `withLibSearch`, ключ-тумблер
 *    `gate`): без подключения `fuzzy` в возможностях нет, и панель гасит опцию;
 *  • `total` — декоратор `withTotalsGate`: тумблер снимает totals у ответа, и
 *    возможности честно объявляют `totals: false` (номера страниц гаснут).
 * Сама логика страницы/перехвата/ошибок — одна на все миры: их различает
 * слой источника, а не ветки потребителя.
 */
function makeSource(name: string): AdaptedSource<CatalogItem> {
  // Каналы панели: статистика перехвата и подпись коррекции. Корректор словаря
  // строит lib/search из `dictionary` САМОГО источника — те же каналы несут
  // оба контура, а у источника без словаря подпись просто гаснет.
  const channels = {
    onStats: (stats: SearchInterceptStats | null) => publishStats(name, stats),
    onCorrection: (info: SearchCorrectionInfo | null) => reportSearchCorrection(name, info),
  }
  return composeSources<CatalogItem>(
    {
      // Товары: родной поиск источника (тумблер `srch`) + lib/search поверх
      // (fuzzy-скан по названию: источник объявляет `scan`).
      products: withLibSearch(
        createLocalItemsSource('products')
          .with(withSearchGate({ gate: 'srch' }))
          .with(withTotalsGate({ gate: 'total' })),
        { gate: 'ls', ...channels },
      ),
      // Фото — «просто данные»: ни родного поиска, ни сканирования, ни
      // фильтров. Возможностей нет — панель гасит опции поиска и поле запроса
      // (не «включено вхолостую», а честно недоступно).
      photos: createLocalItemsSource('photos').with(withTotalsGate({ gate: 'total' })),
      animes: withLibSearch(createAnimesSource(), { gate: 'ls', ...channels }),
    },
    { name, select: (extra) => demoExtraOf(extra ?? {}).src },
  )
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

/** Галерея — тот же локальный источник демо, но без тумблеров опций панели. */
const gallerySource: AdaptedSource<CatalogItem> = defineSource<CatalogItem>({
  name: 'gallery',
  record: catalogRecord,
  scan: {},
  totals: true,
  data: async ({ page, pageSize, signal }) => {
    const r = await getItemsPage({ kind: 'photos', page, pageSize, signal })
    return {
      items: r.items,
      totalItems: r.totalItems,
      totalPages: r.totalPages,
      hasNext: page * pageSize < (r.totalItems ?? 0),
    }
  },
})

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
