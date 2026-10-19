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
//                     владельца: этот путь не повторяем). Три версии API:
//                     `animes` (mix), `animes-rest`, `animes-graphql`.
//
// Поиск — два независимых слоя (обе опции панели):
//   `srch` — РОДНОЙ поиск источника: `q` уезжает в API как `search`
//            (подстрока по названиям). Работает без lib search.
//   `ls`   — lib search поверх источника: перехватчик (fuzzy-ранжирование +
//            коррекция опечаток по словарю) подменяет выдачу на клиенте.
// Выключены оба → `q` до источника не доходит, список — обычный каталог.
//
// Здесь — настройки страницы (ключи, умолчания, регистрация пагинаторов);
// источники данных и серверные мосты к ним — в `sources.ts`.
import type { ShikimoriApi } from '../../../../content/shikimori'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import { SHIKIMORI_FILTER_RELOAD_KEYS, SHIKIMORI_FILTER_SEARCH } from '../../../../content/shikimori-filters'
import type { RickMortyApi } from '../../../../content/rickmorty'
import {
  RICKMORTY_FILTER_KEYS,
  RICKMORTY_FILTER_SCHEMA,
  RICKMORTY_FILTER_SEARCH,
} from '../../../../content/rickmorty-filters'
import { searchQueryValidator } from '#lib/paginate/search/index.js'
import {
  createLocalStorageStorage,
  createUrlAdapter,
  definePaginator,
  extraField,
  getPaginator,
  hasPaginator,
  type EdgeTrigger,
  type Extra,
  type ExtraSearchSpec,
  type ExtraValue,
  type PrependBehavior,
} from '#lib/paginate/index.js'
import type { CatalogItem } from './item-views'
import { cursorExtraField, cursorPointerField } from '../db-demo/definition'
import { gallerySource, makeSource } from './sources'

export type DemoStore = 'url' | 'local' | 'none'

/**
 * Источник данных пагинатора (опция панели `src`).
 *
 * `db` — витрина `#lib/db/index.js`: список строк из живой БД. Он не «демо-данные рядом с
 * демо-данными»: реализация одна и та же, что у страницы `/db-demo`
 * (папка роута `/db-demo`), включая режим курсора и SSR-транспорт. Здесь у него
 * только форма записи общая с каталогом.
 */
export type DemoSrc =
  | 'products'
  | 'photos'
  | 'animes'
  | 'animes-rest'
  | 'animes-graphql'
  | 'rm-rest'
  | 'rm-graphql'
  | 'db'
export const DEMO_SRCS: readonly DemoSrc[] = [
  'products',
  'photos',
  'animes',
  'animes-rest',
  'animes-graphql',
  'rm-rest',
  'rm-graphql',
  'db',
]

/**
 * Shikimori — ОДИН источник в трёх версиях API (решение владельца, ход 85):
 * `animes` — mix (как было до разделения: адреса `?page.src=animes` читаются
 * по-старому), `animes-rest` — только REST, `animes-graphql` — только GraphQL.
 * В отличие от Rick and Morty схемы у версий РАЗНЫЕ: справочники свои (жанры
 * v1 у REST, v2 у GraphQL и mix), а у GraphQL нет «Студий» (вариант «c», ход 96).
 * Поэтому при смене версии фильтры, которых у новой версии нет или чьи
 * значения ей чужие, отсекаются deny-safe с причиной — не применяются молча.
 */
export const DEMO_SHIKIMORI_SRCS: Readonly<Partial<Record<DemoSrc, ShikimoriApi>>> = {
  animes: 'mix',
  'animes-rest': 'rest',
  'animes-graphql': 'graphql',
}

/** Версия API Shikimori у источника; `null` — источник не Shikimori. */
export function demoShikimoriApi(src: DemoSrc | undefined): ShikimoriApi | null {
  return (src != null && DEMO_SHIKIMORI_SRCS[src]) || null
}

/**
 * Rick and Morty — ОДИН источник в двух версиях API (F54): `rm-rest` и
 * `rm-graphql` различаются только транспортом. Схема фильтров у них общая и
 * статичная, ключи адреса те же — поэтому при переключении версии фильтры и
 * запрос остаются в адресе и применяются новой версией без изменений в lib.
 */
export const DEMO_RICKMORTY_SRCS: Readonly<Partial<Record<DemoSrc, RickMortyApi>>> = {
  'rm-rest': 'rest',
  'rm-graphql': 'graphql',
}

/** Ключи потребителя, живущие в хранилище пагинатора (RestorableState.extra). */
export type DemoExtra = {
  /** Источник данных: товары, фото, живые Shikimori и Rick and Morty (REST/GraphQL), БД. */
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
  /**
   * Режим курсора — возможность ИСТОЧНИКА, а не пагинатора: тумблер есть у тех
   * источников, которые умеют продолжать выдачу по подписанному указателю
   * (`?page.after`). Панель связывает его с источником (`enabledBy`), а не с
   * догадкой разметки.
   */
  cur: boolean
  /** Указатель следующего шага: значение выдаёт сервер, клиент его не строит. */
  after: string
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
  /**
   * Якорь хоста в ссылках навигации (`PaginatorHost.hashAnchor`): по имени
   * пагинатора, свой или без якоря. Живой пропс — ссылки следуют за ним.
   */
  anchor: DemoAnchor
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
export type DemoAnchor = 'auto' | 'catalog' | 'off'
export const DEMO_ANCHORS: readonly DemoAnchor[] = ['auto', 'catalog', 'off']

/**
 * Значение пропса `hashAnchor` хоста: `undefined` — якорь по имени пагинатора
 * (`paginator-<name>`), строка — свой якорь, `null` — ссылки без якоря.
 */
export function demoHashAnchor(anchor: DemoAnchor): string | null | undefined {
  return anchor === 'catalog' ? 'catalog' : anchor === 'off' ? null : undefined
}
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


/**
 * Источники, у которых есть ЧТО собирать: схема фильтров строится сервером из
 * живых справочников конкретного каталога, поэтому «у источника есть фильтры»
 * (`capabilities.filters`) — НЕ основание её собирать. У БД фильтры есть
 * (`flt`/`ord` адресом), а схемы Shikimori у них нет и быть не может.
 */
export const DEMO_SCHEMA_SRCS: readonly DemoSrc[] = ['animes', 'animes-rest', 'animes-graphql', 'rm-rest', 'rm-graphql']

export function demoHasFilterSchema(src: DemoSrc | undefined): boolean {
  return src != null && DEMO_SCHEMA_SRCS.includes(src)
}

/**
 * Схема, известная без сервера: у Rick and Morty значения фильтров статичны
 * (их объявляет документация API), поэтому схема одна и та же на сервере и в
 * браузере. `null` — статической схемы нет (Shikimori собирает свою сервером).
 */
export function demoStaticFilterSchema(src: DemoSrc | undefined): CatalogFilterSchema | null {
  return src != null && src in DEMO_RICKMORTY_SRCS ? RICKMORTY_FILTER_SCHEMA : null
}

/**
 * Срез адреса для панели фильтров — без слоя модалок: модалка — чужое состояние,
 * и смена фильтров (ссылка чипа, «Сбросить», форма без JS) её закрывает. Что в
 * адресе своё и как оно названо, решает адаптер пагинатора (`linkFor`,
 * `carryFields`); демо только убирает чужой слой.
 *
 * Вызывающий передаёт ЖИВОЙ срез адреса — `currentSearch()` слоя роутера, а не
 * адрес страницы: пагинатор пишет адрес «мелкой» записью истории, и адрес
 * отрисовки после неё устаревает (баг F5, docs/audit/crutches.md).
 */
export function demoFilterSearch(search: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(search)) {
    if (key === 'modal' || key.startsWith('modal.')) continue
    out[key] = value
  }
  return out
}

export const DEFAULT_DEMO_EXTRA: DemoExtra = {
  src: 'products',
  srch: true,
  ls: false,
  q: '',
  layout: 'list',
  mode: 'accumulate',
  cur: false,
  after: '',
  total: true,
  skel: true,
  topTrigger: 'direction',
  bottomTrigger: 'direction',
  topZone: '40%',
  bottomZone: '40%',
  prepend: 'auto',
  ind: true,
  anchor: 'auto',
  cols: 'auto',
  colW: 220,
  colFit: 25,
}

export const DEFAULT_DEMO_CONFIG: DemoConfig = {
  ...DEFAULT_DEMO_EXTRA,
  store: 'url',
  pageSize: 20,
}

/**
 * Ключи extra, влияющие на ДАННЫЕ источника (смена → сброс + стр. 1).
 * Ключи фильтров входят сюда целиком: смена любого фильтра — новая выдача.
 */
/**
 * Позиционные ключи: `after` выдаётся сервером как «откуда продолжать это окно».
 * Смена условия выдачи (фильтр, порядок, способ навигации) окно пересобирает, и
 * ядро обязано снять указатель вместе с ним: отправленный с новым `ord`, он стоит
 * источнику 400, а осевший в адресе он превращает «ссылку на середину» в ссылку
 * на несуществующую середину.
 */
export const DEMO_POSITION_KEYS = ['after'] as const

export const DEMO_RELOAD_KEYS = [
  'src',
  'srch',
  'ls',
  'q',
  'total',
  // Способ навигации источника меняет то, КАК читается выдача, — значит это новая
  // выдача, а не раскладка. `after` сюда НЕ входит: это указатель, который выдаёт
  // сам сервер, и сброс по нему означал бы «загрузили → сбросили → загрузили».
  // Снимается он другим механизмом — `positionKeys` (см. `DEMO_POSITION_KEYS`).
  'cur',
  ...new Set([...SHIKIMORI_FILTER_RELOAD_KEYS, ...RICKMORTY_FILTER_KEYS]),
] as const

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
  // Ключи курсорного режима — общие с демо БД: тот же валидатор, те же правила
  // (нативный GET-чекбокс приезжает как `on`, токен проверяется по форме).
  cur: cursorExtraField,
  after: cursorPointerField,
  total: bool,
  skel: bool,
  topTrigger: extraField('text', oneOf('off', 'direction', 'edge', 'chat', 'manual')),
  bottomTrigger: extraField('text', oneOf('off', 'direction', 'edge', 'chat', 'manual')),
  topZone: extraField('text', oneOf(...DEMO_ZONES)),
  bottomZone: extraField('text', oneOf(...DEMO_ZONES)),
  prepend: extraField('text', oneOf('auto', 'native', 'js')),
  ind: bool,
  anchor: extraField('text', oneOf(...DEMO_ANCHORS)),
  cols: (v) => (v === 'auto' || v === 2 || v === 3 || v === 4 ? v : undefined),
  colW: extraField('number', (v) => v === 160 || v === 220 || v === 300 || v === 400),
  colFit: extraField('number', (v) => v === 0 || v === 10 || v === 25 || v === 50),
  // Ключи фильтров каталога Shikimori: форма значения — из общего со схемой
  // объявления (`content/shikimori-filters`); допустимость значений проверяет
  // схема на сервере, слой адреса отвечает только за форму и типы.
  // Ключи Rick and Morty — тем же способом; общий ключ `filters.status` берёт
  // валидатор Shikimori (список через запятую): одно значение он пропускает
  // так же, а допустимость проверит схема выбранного источника.
  ...RICKMORTY_FILTER_SEARCH,
  ...SHIKIMORI_FILTER_SEARCH,
}

/**
 * extra из state → типизированный DemoExtra (мусор/отсутствие → дефолт).
 *
 * Ключи фильтров (`filters.*`) идут тем же путём, что и остальные ключи панели:
 * их состав и форма объявлены общей спеку (`SHIKIMORI_FILTER_SEARCH`), поэтому
 * «своих» списков ключей здесь нет — есть один словарь валидаторов.
 */
export function demoExtraOf(extra: Extra): DemoExtra & Record<string, ExtraValue> {
  const out: Record<string, ExtraValue> = { ...DEFAULT_DEMO_EXTRA }
  for (const key of Object.keys(DEMO_EXTRA_SEARCH)) {
    const v = DEMO_EXTRA_SEARCH[key]!(extra[key] ?? null)
    if (v !== undefined) out[key] = v
  }
  return out as DemoExtra & Record<string, ExtraValue>
}

export function demoName(store: DemoStore): string {
  return store === 'url' ? 'demo-url' : store === 'local' ? 'demo-local-ls' : 'demo-local-mem'
}

/** Текущий запрос из extra (`q`); пусто — сквозной проход, каталог как есть. */
export function demoQueryOf(extra: Extra | undefined): string {
  return typeof extra?.q === 'string' ? extra.q.trim() : ''
}

/**
 * Источник по адресу — ДО загрузки страницы: лоадер по нему начинает сборку схемы
 * фильтров параллельно с первой страницей. Адрес читает адаптер пагинатора
 * (`getInitial`), своего разбора у демо нет; итог лоадер всё равно сверяет со снапшотом.
 */
export async function demoSrcOfUrl(name: string, url: string): Promise<DemoSrc> {
  return selectSrc((await getPaginator(name).adapter.getInitial({ url })).extra)
}

/** Выбор источника по extra: deny-safe разбор, мусор → источник по умолчанию. */
const selectSrc = (extra: Extra | undefined): DemoSrc => demoExtraOf(extra ?? {}).src

/** Get-or-create: зарегистрировать пагинатор под способ хранения и вернуть его имя. */
export function ensureDemoPaginator(store: DemoStore): string {
  const name = demoName(store)
  if (hasPaginator(name)) return name
  if (store === 'url') {
    definePaginator<CatalogItem>({
      name,
      pageSize: DEFAULT_DEMO_CONFIG.pageSize,
      reloadKeys: DEMO_RELOAD_KEYS,
      positionKeys: DEMO_POSITION_KEYS,
      adapter: createUrlAdapter<CatalogItem>({
        name,
        source: makeSource(name, selectSrc),
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
      source: makeSource(name, selectSrc),
      pageSize: DEFAULT_DEMO_CONFIG.pageSize,
      reloadKeys: DEMO_RELOAD_KEYS,
      positionKeys: DEMO_POSITION_KEYS,
      extraDefaults: DEFAULT_DEMO_EXTRA,
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
