// Источники данных демо-пагинатора: локальные товары и фото, живые Shikimori
// (mix/REST/GraphQL) и Rick and Morty (REST/GraphQL), строки БД — и серверные
// мосты к ним (SSR строит снапшот без похода в собственный HTTP-эндпоинт).
// Настройки страницы (ключи, умолчания, регистрация пагинаторов) — в
// `definition.ts`: он берёт отсюда `makeSource` и `gallerySource`.
import { getItemsPage } from '../../../../content/items'
import {
  SHIKIMORI_LIMIT_MAX,
  getAnimesPage,
  getShikimoriFilters,
  getShikimoriTerms,
  type AnimesPage,
  type ShikimoriApi,
} from '../../../../content/shikimori'
import { catalogFilterSchemas, type CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import { shikimoriFilterKeys, shikimoriFilterSource } from '../../../../content/shikimori-filters'
import { getCharactersPage, type CharactersPage, type RickMortyApi } from '../../../../content/rickmorty'
import { RICKMORTY_FILTER_KEYS } from '../../../../content/rickmorty-filters'
import { reportSearchCorrection, withLibSearch, type SearchCorrectionInfo } from '#lib/paginate/search/index.js'
import {
  composeSources,
  defineSource,
  withSearchGate,
  withTotalsGate,
  type AdaptedSource,
  type Extra,
  type PageResponse,
  type SourceLook,
  type SourceRecordSpec,
} from '#lib/paginate/index.js'
import { catalogTexts, catalogTitle, type CatalogItem } from './item-views'
import { DB_LIST_FILTER_KEYS, fetchDbPosts, withDbCursor } from '#lib/ui/demo/db-list/definition.js'

/** Запросы схем в полёте (по версии API): параллельные вызовы ждут один ответ. */
const filterSchemaInflight = new Map<ShikimoriApi, Promise<CatalogFilterSchema>>()

/**
 * Схема фильтров живого источника версии `api`: из памяти вкладки
 * (`catalogFilterSchemas`), иначе — один раз из роута `/api/shikimori/filters`
 * (и в память). Роут нужен, только когда схема не пришла со страницей: источник
 * переключили в панели (адрес пишется без серверной загрузки) или пришли
 * переходом внутри сайта, а в памяти её ещё нет; ещё — повтор после сбоя
 * сборки на сервере.
 */
export async function loadFilterSchema(api: ShikimoriApi = 'mix'): Promise<CatalogFilterSchema> {
  const known = catalogFilterSchemas.recall(shikimoriFilterSource(api))
  if (known) return known
  let inflight = filterSchemaInflight.get(api)
  if (!inflight) {
    inflight = getShikimoriFilters(api)
      .then((schema) => {
        catalogFilterSchemas.remember(schema)
        return schema
      })
      .finally(() => {
        filterSchemaInflight.delete(api)
      })
    filterSchemaInflight.set(api, inflight)
  }
  return await inflight
}

// ── Мост к живому источнику на сервере ─────────────────────────────────────
/**
 * На SSR тот же базовый источник обязан уметь отдать страницу каталога, не
 * сходя с сервера: снапшот страницы строится в лоадере (`initServerPaginator`),
 * а ходить оттуда в собственный HTTP-эндпоинт — лишний круг. Поэтому
 * server-only лоадер подставляет транспорт напрямую к `#lib/server/shikimori.js`
 * (там кэш, троттлинг и User-Agent); в браузере мост пуст, и источник идёт в
 * свой эндпоинт `/api/shikimori/animes`. Развилка в ОДНОМ месте — сама логика
 * страницы/перехвата/ошибок у источника одна на оба мира.
 */
export type LiveTransport = {
  fetchPage(query: {
    /** Версия API Shikimori (`animes` — mix, `animes-rest`, `animes-graphql`). */
    api: ShikimoriApi
    page: number
    limit: number
    search?: string
    /** Фильтры в канонических ключах: серверный транспорт применяет их сам. */
    filters?: Readonly<Record<string, unknown>>
  }): Promise<AnimesPage>
}

let liveTransport: LiveTransport | null = null

/** Подставляет серверный транспорт живого источника (только из server-only кода). */
export function setLiveServerTransport(transport: LiveTransport | null): void {
  liveTransport = transport
}

/** Серверный мост Rick and Morty — тот же приём, что у Shikimori. */
export type RickMortyTransport = {
  fetchPage(query: {
    api: RickMortyApi
    page: number
    limit: number
    search?: string
    filters?: Readonly<Record<string, unknown>>
  }): Promise<CharactersPage>
}

let rickMortyTransport: RickMortyTransport | null = null

/** Подставляет серверный транспорт Rick and Morty (только из server-only кода). */
export function setRickMortyServerTransport(transport: RickMortyTransport | null): void {
  rickMortyTransport = transport
}

/**
 * Страница персонажей: сервер — напрямую в API, браузер — через свой бэкенд.
 * Число страниц API отдаёт (`count`), поэтому у источника есть номера страниц.
 */
async function loadCharactersPage(
  api: RickMortyApi,
  look: SourceLook,
  q: string,
  filters: Readonly<Record<string, string>>,
): Promise<PageResponse<CatalogItem>> {
  const query = {
    api,
    page: look.page,
    limit: look.pageSize,
    ...(q ? { search: q } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  }
  const res = rickMortyTransport
    ? await rickMortyTransport.fetchPage(query)
    : await getCharactersPage({ ...query, signal: look.signal })
  for (const item of res.dropped ?? []) {
    console.warn(`[rickmorty] фильтр «${item.key}» не применён: ${item.reason}`)
  }
  return { items: res.items, totalItems: res.totalItems, totalPages: res.totalPages, hasNext: res.hasNext }
}

/**
 * Страница живого каталога: сервер — напрямую в API, браузер — через свой
 * бэкенд. Фильтры (объявленные источником, `filters` в спеке) едут ОДНИМ
 * запросом вместе со страницей и поиском: их применяет серверная зона по живой
 * схеме, а неприменённое она возвращает списком `dropped` — молчание запрещено.
 */
async function loadAnimePage(
  api: ShikimoriApi,
  look: SourceLook,
  q: string,
  filters: Readonly<Record<string, string>>,
): Promise<PageResponse<CatalogItem>> {
  const query = {
    api,
    page: look.page,
    limit: look.pageSize,
    ...(q ? { search: q } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  }
  const res = liveTransport
    ? await liveTransport.fetchPage(query)
    : await getAnimesPage({ ...query, signal: look.signal })
  if (res.dropped?.length) {
    for (const item of res.dropped) {
      console.warn(`[shikimori] фильтр «${item.key}» не применён: ${item.reason}`)
    }
  }
  // Числа страниц Shikimori API не отдаёт: только «страница пришла полной».
  return { items: res.items, hasNext: res.hasNext }
}

/**
 * Паспорт записи каталога — ОДИН на все три источника демо: как читать любую
 * запись (id, заголовок, тексты) знает слой источника, а не потребитель. По
 * нему paginate/search ранжирует и дедуплицирует, а вьюхи берут заголовки.
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
 * разрешено (`scan`) — поверх работает paginate/search (fuzzy по названию).
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
 * запрос = размер батча paginate/search: больше сервис молча режет до 50) и словарь
 * терминов для коррекции опечаток. Totals Shikimori не отдаёт — номерной
 * навигации у него нет (R12: только стрелки).
 *
 * Тумблер `srch` — декоратор `withSearchGate`: при выключенном родном поиске
 * источник получает пустой `q` (каталог как есть), но сам `q` остаётся в extra
 * и доступен paginate/search — сканирование без сужения источником.
 */
function createAnimesSource(api: ShikimoriApi): AdaptedSource<CatalogItem> {
  return defineSource<CatalogItem>({
    // Имя mix прежнее (`animes`): статистика и словарь paginate/search по нему не
    // меняются у адресов, сделанных до разделения на версии.
    name: api === 'mix' ? 'animes' : `animes-${api}`,
    record: catalogRecord,
    search: { minLength: 2 },
    scan: { batchSize: SHIKIMORI_LIMIT_MAX },
    totals: false,
    // Фильтры объявляет САМ источник: ключи выведены из схемы схемы
    // (`content/shikimori-filters`), а значения и связки живут в серверной зоне
    // (`#lib/server/shikimori-schema.js`) и приезжают роутом `/api/shikimori/filters`.
    // Возможность видна панели (`capabilities.filters`) — UI гасит фильтры у
    // источников, которые их не объявляют.
    // Версия решает состав: у `graphql` нет ключей студий (нет справочника).
    filters: shikimoriFilterKeys(api),
    dictionary: () => getShikimoriTerms(api),
    data: (look, input) => loadAnimePage(api, look, input.q, input.filters),
  }).with(withSearchGate({ gate: 'srch' }))
}

/**
 * Rick and Morty как источник: родной поиск по имени (`q` → `name` API),
 * фильтры из статической схемы, totals (`count` API) и сканирование для
 * paginate/search батчами по странице API. Версия API — параметр, а не второй
 * источник: всё, кроме транспорта, у REST и GraphQL общее.
 */
function createRickMortySource(api: RickMortyApi): AdaptedSource<CatalogItem> {
  return defineSource<CatalogItem>({
    name: `rickmorty-${api}`,
    record: catalogRecord,
    search: { minLength: 2 },
    scan: { batchSize: 20 },
    totals: true,
    filters: RICKMORTY_FILTER_KEYS,
    data: (look, input) => loadCharactersPage(api, look, input.q, input.filters),
  })
    .with(withSearchGate({ gate: 'srch' }))
    .with(withTotalsGate({ gate: 'total' }))
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
 *  • `ls` — подключение paginate/search (декоратор `withLibSearch`, ключ-тумблер
 *    `gate`): без подключения `fuzzy` в возможностях нет, и панель гасит опцию;
 *  • `total` — декоратор `withTotalsGate`: тумблер снимает totals у ответа, и
 *    возможности честно объявляют `totals: false` (номера страниц гаснут).
 * Сама логика страницы/перехвата/ошибок — одна на все миры: их различает
 * слой источника, а не ветки потребителя.
 */
export function makeSource(
  name: string,
  select: (extra: Extra | undefined) => string,
): AdaptedSource<CatalogItem> {
  // Каналы панели: статистика перехвата и подпись коррекции. Корректор словаря
  // строит paginate/search из `dictionary` САМОГО источника — те же каналы несут
  // оба контура, а у источника без словаря подпись просто гаснет.
  // Статистику перехвата панель берёт из ОБЩЕГО канала paginate/search: `name` при
  // подключении `withLibSearch` делает это автоматически (свой реестр странице
  // не нужен). Здесь остаётся только подпись коррекции.
  const channels = {
    onCorrection: (info: SearchCorrectionInfo | null) => reportSearchCorrection(name, info),
  }
  return composeSources<CatalogItem>(
    {
      // Товары: родной поиск источника (тумблер `srch`) + paginate/search поверх
      // (fuzzy-скан по названию: источник объявляет `scan`).
      products: withLibSearch(
        createLocalItemsSource('products')
          .with(withSearchGate({ gate: 'srch' }))
          .with(withTotalsGate({ gate: 'total' })),
        { gate: 'ls', name, ...channels },
      ),
      // Фото — «просто данные»: ни родного поиска, ни сканирования, ни
      // фильтров. Возможностей нет — панель гасит опции поиска и поле запроса
      // (не «включено вхолостую», а честно недоступно).
      photos: createLocalItemsSource('photos').with(withTotalsGate({ gate: 'total' })),
      // Shikimori в трёх версиях API: всё, кроме транспорта и справочников, общее.
      animes: withLibSearch(createAnimesSource('mix'), { gate: 'ls', name, ...channels }),
      'animes-rest': withLibSearch(createAnimesSource('rest'), { gate: 'ls', name, ...channels }),
      'animes-graphql': withLibSearch(createAnimesSource('graphql'), { gate: 'ls', name, ...channels }),
      'rm-rest': withLibSearch(createRickMortySource('rest'), { gate: 'ls', name, ...channels }),
      'rm-graphql': withLibSearch(createRickMortySource('graphql'), { gate: 'ls', name, ...channels }),
      // БД — НЕ второй реализации списка: данные читает тот же `fetchDbPosts`
      // (SSR — прямаем в слой, браузер — `/api/db-posts`), отличие только в форме
      // записи (паспорт `catalogRecord`) и в том, что здесь запись — часть union'а.
      // Lib/search к нему не подключается: сканировать живую выдачу БД демо не
      // договоривались, и панель честно гасит `ls` (нет возможности `fuzzy`).
      db: defineSource<CatalogItem>({
        name: 'db_demo_posts',
        record: catalogRecord,
        filters: DB_LIST_FILTER_KEYS,
        totals: true,
        data: (look, input) => fetchDbPosts(look, input),
      }).with(withDbCursor<CatalogItem>()),
    },
    { name, select },
  )
}

/** Галерея — тот же локальный источник демо, но без тумблеров опций панели. */
export const gallerySource: AdaptedSource<CatalogItem> = defineSource<CatalogItem>({
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
