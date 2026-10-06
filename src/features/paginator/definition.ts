// Демо-фабрика пагинаторов (порт paginators.ts React-версии).
//
// ОДИН пагинатор на способ хранения (адаптер/хранилище) — имя стабильно:
//   demo-url        — URL-адаптер: ?page, ?page.size, ?page.<key> (формат как у модалок)
//   demo-local-ls   — local-адаптер + localStorage (ключ pag:demo-local-ls)
//   demo-local-mem  — local-адаптер + память (сбрасывается при reload)
import { getItemsPage, type DemoItem, type ItemKind } from '../../content/items'
import {
  createLocalStorageStorage,
  createUrlAdapter,
  definePaginator,
  extraField,
  hasPaginator,
  type EdgeTrigger,
  type Extra,
  type ExtraValue,
  type ExtraSearchSpec,
  type PrependBehavior,
  type PageRequest,
  type PageResponse,
  type Source,
} from '$lib/paginate'

export type DemoStore = 'url' | 'local' | 'none'

/** Ключи потребителя, живущие в хранилище пагинатора (RestorableState.extra). */
export type DemoExtra = {
  /** Тип содержимого (источник): товары или фото. */
  kind: ItemKind
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
export const DEMO_RELOAD_KEYS = ['kind', 'total'] as const

const oneOf =
  (...values: readonly string[]) =>
  (v: ExtraValue): boolean =>
    typeof v === 'string' && values.includes(v)
const bool = extraField('boolean')

/** Спецификация `?page.<key>` — ОДНА для validateSearch роута, адаптера и хоста (deny-safe). */
export const DEMO_EXTRA_SEARCH: ExtraSearchSpec = {
  kind: extraField('text', oneOf('products', 'photos')),
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

/** Источник читает kind/total из req.extra — один пагинатор обслуживает все варианты. */
const demoSource: Source<DemoItem> = async ({
  page,
  pageSize,
  extra,
}: PageRequest): Promise<PageResponse<DemoItem>> => {
  const cfg = demoExtraOf(extra ?? {})
  const r = await getItemsPage({ kind: cfg.kind, page, pageSize })
  if (cfg.total) {
    return { items: r.items, totalItems: r.totalItems, totalPages: r.totalPages }
  }
  return { items: r.items, hasNext: page * pageSize < (r.totalItems ?? 0) }
}

/** Get-or-create: зарегистрировать пагинатор под способ хранения и вернуть его имя. */
export function ensureDemoPaginator(store: DemoStore): string {
  const name = demoName(store)
  if (hasPaginator(name)) return name
  if (store === 'url') {
    definePaginator<DemoItem>({
      name,
      pageSize: DEFAULT_DEMO_CONFIG.pageSize,
      reloadKeys: DEMO_RELOAD_KEYS,
      adapter: createUrlAdapter<DemoItem>({
        name,
        source: demoSource,
        pageSize: DEFAULT_DEMO_CONFIG.pageSize,
        pageSizes: DEMO_PAGE_SIZES,
        pageParam: 'page',
        extraSearch: DEMO_EXTRA_SEARCH,
        extraDefaults: DEFAULT_DEMO_EXTRA,
      }),
    })
  } else {
    definePaginator<DemoItem>({
      name,
      source: demoSource,
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
