/**
 * Источники демо-раздела, собранные через общий слой (`lib/paginate/source`):
 * здесь только ДАННЫЕ о них — что умеют и как отдают страницу. Никакого поиска
 * и никакого фреймворка: связка с lib/search живёт в `search.ts` (отдельная
 * часть), поэтому пагинатор работает и без неё.
 *
 * Возможности объявляют сами источники (а не тумблеры панели):
 *   • товары — данные + число страниц (поиск появится на следующем этапе);
 *   • фото   — «просто данные»: ни поиска, ни фильтров, ни fuzzy;
 *   • аниме  — каталог Shikimori: родной поиск (подстрока на бэкенде), fuzzy,
 *              бюджеты добора живого API; числа страниц у API нет.
 */
import { defineSource, defineSourceSwitch, type AdaptedSource, type CapabilityKeys } from '$lib/paginate'
import { getItemsPage, type DemoEntry, type DemoItem } from '../../content/items'
import { loadAnimePage, type AnimeRecord } from '../../content/anime'

/**
 * Демо-ключ «поиск включён» (`?page.search=false` — поля нет, запрос до источника
 * не доходит). Сам гейт живёт в спецификации поиска: оболочка убирает запрос ДО
 * источника, поэтому источники про тумблер не знают.
 */
const searchEnabled = (extra: Record<string, unknown>): boolean => extra.search !== false

/** Товары: 299 записей, число страниц известно. Родного поиска пока нет. */
export const productsSource: AdaptedSource<DemoItem> = defineSource<DemoItem>({
  id: 'products',
  label: 'Товары',
  totals: true,
  page: ({ page, pageSize, signal }) => getItemsPage({ kind: 'products', page, pageSize, signal }),
})

/** Фото: «просто данные» — без поиска, фильтров и fuzzy. */
export const photosSource: AdaptedSource<DemoItem> = defineSource<DemoItem>({
  id: 'photos',
  label: 'Фото',
  totals: true,
  page: ({ page, pageSize, signal }) => getItemsPage({ kind: 'photos', page, pageSize, signal }),
})

/** Аниме: каталог Shikimori живьём (SSR зовёт API, браузер — наш бэкенд). */
export const animeSource: AdaptedSource<AnimeRecord> = defineSource<AnimeRecord>({
  id: 'anime',
  label: 'Аниме (Shikimori API)',
  // API не отдаёт общего числа записей → номерной навигации у источника нет.
  totals: false,
  search: {
    // Родной поиск: запрос уходит аргументом `search` (подстрока на бэкенде).
    enabled: searchEnabled,
    fuzzy: {
      id: (record) => record.id,
      texts: (record) => [record.title, ...record.aliases],
      // Бюджеты добора живого API: батч — потолок API (50), пара батчей на вызов,
      // чтобы «поиск» не превращался в скачивание всего каталога Shikimori.
      batchSize: 50,
      maxBatchesPerCall: 2,
      maxBatchesDeepLink: 4,
      parallelBatches: 2,
    },
  },
  page: async ({ page, pageSize, extra, signal }) => {
    const q = typeof extra?.q === 'string' ? extra.q : undefined
    const result = await loadAnimePage({ page, limit: pageSize, q }, { signal })
    // totalItems не отдаём принципиально: API его не знает, а выдумывать нельзя.
    return { items: result.items, hasNext: result.hasNext }
  },
})

/**
 * Источники раздела по ключу `kind` (он же — выбор в панели). Приведение типов
 * осознанное: пагинатор работает с объединением записей (`DemoEntry`), а каждый
 * источник обслуживает свой вид (спецификации `id/texts` принимают запись своего
 * вида — отсюда формальная инвариантность дженерика).
 */
export const demoKindSources: Record<string, AdaptedSource<DemoEntry>> = {
  products: productsSource as AdaptedSource<DemoEntry>,
  photos: photosSource as AdaptedSource<DemoEntry>,
  anime: animeSource as AdaptedSource<DemoEntry>,
}

/**
 * ОДИН пагинатор раздела: выбор источника — ключ extra. Возможности, спецификации
 * поиска и страницы делегируются выбранному источнику, поэтому панель и UI всегда
 * видят правду о текущем выборе (у фото поиска нет, у аниме нет числа страниц).
 *
 * `dataKeys` переключателя — его собственные ключи данных: смена любого из них
 * означает «данные будут другие» → пагинатор сбрасывает страницу и перезагружает.
 * Список не пишется рукой в демо: он собирается слоем источника (см. `demoSource.dataKeys`).
 */
export const DEMO_CAPABILITY_KEYS: CapabilityKeys = {
  search: ['q', 'search'],
  fuzzy: ['fuzzy'],
}

export const demoSource: AdaptedSource<DemoEntry> = defineSourceSwitch<DemoEntry>({
  id: 'demo',
  label: 'Демо-раздел',
  key: 'kind',
  sources: demoKindSources,
  fallback: 'products',
  dataKeys: ['q', 'search', 'fuzzy'],
  // Ключи по возможностям — знание ИСТОЧНИКА, а не панели: оболочка по ним
  // чистит ключи, которых у нового выбора нет (через хранилище, обычным setExtra).
  capabilityKeys: DEMO_CAPABILITY_KEYS,
})
