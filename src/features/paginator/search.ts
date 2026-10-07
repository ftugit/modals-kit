/**
 * Часть ПОИСКА демо-раздела: единственное место, где пагинатор связывается с
 * lib/search. Это отдельная часть — если её убрать из роута (и не звать
 * `demoSearchSource`), пагинатор продолжит работать: источники и их возможности
 * живут в `sources.ts` и про lib search не знают.
 *
 * Что здесь делается:
 *   • `withSearch` вешает перехватчик на адаптированный источник и берёт
 *     спецификацию усиления (id/texts/бюджеты) У САМОГО ИСТОЧНИКА;
 *   • сюда же приходит коррекция опечаток: словарь — дело поиска, а не источника
 *     (поэтому источник объявляет `fuzzy` без `correct`, а поиск подставляет его
 *     по выбранному источнику);
 *   • тумблер «lib/search» (`?page.fuzzy=false`) — политика приложения: выключен —
 *     запрос уходит источнику как есть (родной поиск).
 */
import { withSearch, createLazyCorrector } from '$lib/search'
import type { SearchCorrectionInfo, QueryCorrector } from '$lib/search'
import type { AdaptedSource, Extra } from '$lib/paginate'
import type { DemoEntry } from '../../content/items'
import { demoSource } from './sources'

/**
 * Ленивый корректор опечаток каталога Shikimori: артефакт `display\tdf` собирает
 * наш бэкенд из образца популярного каталога, а fuzzy-сопоставление исполняется
 * только на клиенте (на сервере словарь не строится).
 */
const loadAnimeCorrector: () => Promise<QueryCorrector | null> = createLazyCorrector(async () => {
  const response = await fetch('/api/anime/terms')
  return response.ok ? response.text() : ''
})

/**
 * Коррекция запроса для каталога Shikimori. Словаря нет или термина рядом не
 * нашлось — отдаём «исправлять нечего» с СЫРЫМ запросом: контур остаётся
 * серверным сужением (родной поиск), а не слепым сканированием живого API.
 */
async function correctAnimeQuery(query: string): Promise<SearchCorrectionInfo | null> {
  if (typeof window === 'undefined') return null // fuzzy никогда на сервере
  const corrector = await loadAnimeCorrector()
  const result = corrector?.correct(query)
  const corrected = result?.correctedQuery.trim()
  if (!result || !corrected) return { query, corrected: query, changed: false }
  return { query, corrected, changed: result.changed }
}

/**
 * Источник демо-пагинатора вместе с частью поиска. Возможности и ключи данных
 * сохраняются (это тот же источник, обёрнутый перехватчиком), поэтому панель
 * видит правду: у фото поиска нет — усиление туда не встанет.
 */
export function demoSearchSource(name: string): AdaptedSource<DemoEntry> {
  return withSearch<DemoEntry>(demoSource, {
    name,
    // Демо-тумблер lib/search: выключен — запрос обслуживает родной поиск.
    active: (extra) => extra.fuzzy !== false,
    // Словарь опечаток — по выбранному источнику (у остальных его пока нет).
    correct: (extra: Extra) => (extra.kind === 'anime' ? correctAnimeQuery : undefined),
  })
}
