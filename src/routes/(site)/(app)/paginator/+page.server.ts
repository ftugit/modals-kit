import type { PageServerLoad } from './$types'
import { afterResponse } from '#lib/server/after-response.js'
import { getShikimoriFilterSchema } from '#lib/server/shikimori-schema.js'
import { fetchAnimesPage } from '#lib/server/shikimori-filters.js'
import { fetchCharactersPage } from '#lib/server/rickmorty.js'
import {
  createPaginatorStore,
  initServerPaginator,
  type PaginatorState,
} from '#lib/paginate/index.js'
import {
  DEFAULT_DEMO_EXTRA,
  DEFAULT_GALLERY_EXTRA,
  demoHasFilterSchema,
  demoShikimoriApi,
  demoSrcOfSearch,
  demoStaticFilterSchema,
  ensureDemoPaginator,
  ensureGalleryPaginator,
} from './definition'
import { setLiveServerTransport, setRickMortyServerTransport } from './sources'
import type { DemoSrc } from './definition'
import type { DemoItem } from '../../../../content/items'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import type { CatalogItem } from './item-views'
import type { PaginatorLoaderData } from './types'

/**
 * Мост живого источника на сервере: лоадер отдаёт пагинатору транспорт прямо
 * к серверному модулю Shikimori (`#lib/server/shikimori.js` — кэш, троттлинг,
 * User-Agent), поэтому SSR-снапшот строится одним запросом на сервере и БЕЗ
 * обращения к собственному HTTP-эндпоинту. В браузере тот же источник идёт в
 * `/api/shikimori/animes` (см. `content/shikimori.ts`).
 *
 * Вызов идемпотентен и живёт на уровне модуля: транспорт — инвариант сервера,
 * а не состояние запроса.
 */
setLiveServerTransport({
  async fetchPage(query) {
    // Фильтры применяет ТОТ ЖЕ конвейер, что и роут (`fetchAnimesPage`): один
    // разбор, одна живая схема, одни связки. Иначе SSR-снапшот строился бы по
    // другим правилам, чем клиентская догрузка, — и «перезагрузка страницы
    // меняет выдачу» вернулось бы.
    const { api, filters, ...page } = query
    return await fetchAnimesPage({ api, query: page, filters: filters ?? {} })
  },
})

// Rick and Morty — тот же приём: SSR идёт в серверный модуль напрямую, один
// конвейер фильтров с роутом `/api/rickmorty/characters`.
setRickMortyServerTransport({
  fetchPage: (query) => fetchCharactersPage(query),
})

/**
 * Загрузка демонстрации пагинатора. Адрес здесь НЕ правится: пустые ключи
 * нативной формы убирает клиент заменой записи истории (`syncAddress` в
 * `#lib/paginate/sveltekit/router.ts`, шаг на привязке роутера в URL-адаптере) — без
 * переадресации и без лишнего перехода, а без JavaScript шага нет вовсе:
 * пустое значение для слоя тождественно отсутствию ключа (решение владельца
 * 2026-10-08: «если очистка url не будет требовать редиректа, то очищай»).
 *
 * `isDataRequest` — переход внутри сайта: схема фильтров тогда не едет —
 * браузер держит её в памяти вкладки (`catalogFilterSchemas`), а если там
 * пусто, берёт один раз роутом. Сборку сервер начинает, как только готова страница (P4):
 * запрос клиента встаёт в уже идущую. Полная отрисовка (первый заход, перезагрузка,
 * любой запрос без JS) схему несёт: без неё нет ни разметки фильтров без JS,
 * ни гидратации.
 */
export const load: PageServerLoad = async ({ url, isDataRequest, platform }) => {
  const store = createPaginatorStore()
  const defaultName = ensureDemoPaginator('url')
  store.update<CatalogItem>(defaultName, (state) => ({
    ...state,
    extra: { ...DEFAULT_DEMO_EXTRA },
  }))

  const href = `${url.pathname}${url.search}`
  const galleryName = ensureGalleryPaginator()
  store.update<CatalogItem>(galleryName, (state) => ({
    ...state,
    extra: { ...DEFAULT_GALLERY_EXTRA },
  }))

  // Схема фильтров собирается ПАРАЛЛЕЛЬНО с первой страницей: источник
  // известен из адреса, ждать снапшота незачем. Страница с фильтрами и так
  // ждёт ту же сборку (она одна на всех ждущих), а страница без фильтров
  // раньше платила запрос страницы + сборку подряд — теперь большее из двух.
  const earlySrc = demoSrcOfSearch(url.searchParams)
  const earlySchema = isDataRequest ? Promise.resolve(null) : schemaOf(earlySrc)

  const [snapshot, gallerySnapshot, early]: [
    PaginatorState<CatalogItem>,
    PaginatorState<DemoItem>,
    CatalogFilterSchema | null,
  ] = await Promise.all([
    initServerPaginator<CatalogItem>(store, defaultName, { url: href }),
    // Галерея — вторая полоса под своим префиксом `?gallery.*`, всегда фото.
    initServerPaginator<DemoItem>(store, galleryName, { url: href }),
    earlySchema,
  ])

  // Сверка с тем, что выбрал сам пагинатор: разойтись они не должны, но
  // если разошлись — правда за снапшотом, схема берётся по нему.
  const src = snapshot.extra?.src as DemoSrc | undefined
  // Переход внутри сайта: схема в ответ не едет (её держит память вкладки), но
  // сборку запускаем, не дожидаясь, — пока ответ летит, а страница рисуется и
  // монтируется. Если во вкладке схемы нет, клиент спросит её роутом и встанет в
  // ЭТУ сборку (single-flight в `getShikimoriFilterSchema`); если есть — сборка
  // прогреет серверный кэш. Запуск — ПОСЛЕ страницы, не вместе с ней: у них общая
  // очередь лимита Shikimori, и ~10 запросов справочников задержали бы саму
  // страницу (замер: `__data.json` 0,6 → 2,3 с). Ошибку `schemaOf` превращает в `null`.
  // `afterResponse`: на Vercel/Cloudflare функцию не заморозят посреди сборки после ответа.
  if (isDataRequest) afterResponse(schemaOf(src), { platform })
  const loaderData: PaginatorLoaderData = {
    defaultName,
    snapshot,
    gallerySnapshot,
    filterSchema: isDataRequest ? null : src === earlySrc ? early : await schemaOf(src),
  }
  return { loaderData }
}

/**
 * Схема фильтров — только для источника, который их объявляет, и только когда
 * он выбран адресом. Товарам и фото схему не собирают вовсе: сборка трогает
 * живые справочники источника, и страница без фильтров её не ждёт.
 *
 * Без серверной схемы SSR-разметка фильтров не нарисуется (без JavaScript
 * фильтры работают только через неё) — поэтому сбой сборки не роняет страницу:
 * панель просто не показывается, а клиент попробует схему сам.
 */
async function schemaOf(src: DemoSrc | undefined): Promise<CatalogFilterSchema | null> {
  if (!demoHasFilterSchema(src)) return null
  const fixed = demoStaticFilterSchema(src)
  if (fixed) return fixed
  try {
    return await getShikimoriFilterSchema({ api: demoShikimoriApi(src) ?? 'mix' })
  } catch {
    return null
  }
}
