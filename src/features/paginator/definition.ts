// Демо-фабрика пагинаторов (порт paginators.ts React-версии).
//
// ОДИН пагинатор на способ хранения (адаптер/хранилище) — имя стабильно:
//   demo-url        — URL-адаптер: ?page, ?page.size, ?page.<key> (формат как у модалок)
//   demo-local-ls   — local-адаптер + localStorage (ключ pag:demo-local-ls)
//   demo-local-mem  — local-адаптер + память (сбрасывается при reload)
//
// Раздел ОДИН и на каталог, и на поиск (как страница Shikimori в исходнике):
// источник выбирается опцией панели (`extra.kind`), а вот ЧТО источник умеет —
// знает сам источник (`sources.ts`), пагинатор получает возможности оттуда и
// сообщает их UI. Поиск подключён отдельной частью (`search.ts`): убранная часть
// поиска ничего не ломает, а источник без поиска просто не предлагает его в UI.
import {
  createLocalStorageStorage,
  createUrlAdapter,
  definePaginator,
  extraField,
  hasPaginator,
  sanitizeQueryValue,
  type EdgeTrigger,
  type Extra,
  type ExtraSearchSpec,
  type ExtraValue,
  type PrependBehavior,
} from '$lib/paginate'
import type { DemoEntry, DemoItem } from '../../content/items'
import { ANIME_MAX_QUERY } from '../../content/anime'
import { demoSource, photosSource } from './sources'
import { demoSearchSource } from './search'

export type DemoStore = 'url' | 'local' | 'none'
/** Источник данных пагинатора: демо-наборы или каталог Shikimori. */
export type DemoKind = 'products' | 'photos' | 'anime'

/** Ключи потребителя, живущие в хранилище пагинатора (RestorableState.extra). */
export type DemoExtra = {
  /** Тип содержимого (источник): товары, фото или аниме (Shikimori API). */
  kind: DemoKind
  /** Раскладка (UI): список или 4 колонки round-robin. */
  layout: 'list' | 'columns'
  /** accumulate — страницы складываются (подгрузка); single — классическая смена (REPLACE). */
  mode: 'accumulate' | 'single'
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
 * Ключи extra, влияющие на ДАННЫЕ, — их объявляет САМ ИСТОЧНИК (переключатель
 * собрал их из своих ключей и ключей выбранных источников). Ручного списка нет:
 * забыть ключ нельзя, потому что списка в демо больше не существует.
 */
export const DEMO_RELOAD_KEYS: readonly string[] = demoSource.dataKeys

const oneOf =
  (...values: readonly string[]) =>
  (v: ExtraValue): boolean =>
    typeof v === 'string' && values.includes(v)
const bool = extraField('boolean')
/** Ключ запроса в адресе — та же нормализация, что на пути «extra → источник». */
const queryField =
  (maxLength: number) =>
  (raw: ExtraValue): ExtraValue | undefined =>
    sanitizeQueryValue(raw, maxLength)

/** Спецификация `?page.<key>` — ОДНА для validateSearch роута, адаптера и хоста (deny-safe). */
export const DEMO_EXTRA_SEARCH: ExtraSearchSpec = {
  kind: extraField('text', oneOf('products', 'photos', 'anime')),
  layout: extraField('text', oneOf('list', 'columns')),
  mode: extraField('text', oneOf('accumulate', 'single')),
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
  // Запрос — общий санитайзер слоя источника (`sanitizeQueryValue`): сырой q из
  // адреса нормализуется централизованно (управляющие, длина), пустой = «ключа нет».
  q: queryField(ANIME_MAX_QUERY),
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
        source: demoSearchSource(name),
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
      source: demoSearchSource(name),
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

export function ensureGalleryPaginator(): string {
  if (hasPaginator(GALLERY_NAME)) return GALLERY_NAME
  definePaginator<DemoItem>({
    name: GALLERY_NAME,
    pageSize: 12,
    adapter: createUrlAdapter<DemoItem>({
      name: GALLERY_NAME,
      source: photosSource,
      pageSize: 12,
      pageSizes: GALLERY_PAGE_SIZES,
      pageParam: GALLERY_PAGE_PARAM,
      extraSearch: GALLERY_EXTRA_SEARCH,
      extraDefaults: DEFAULT_GALLERY_EXTRA,
    }),
  })
  return GALLERY_NAME
}
