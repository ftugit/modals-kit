// Контракты lib search — тонкий слой над lib/paginate: у поиска нет своего
// ядра данных, страниц и гонок. Поиск ПЕРЕХВАТЫВАЕТ пагинатор, подменяя его
// источник: пустой запрос — сквозной проход (обычный каталог), с запросом —
// поиск забирает у того же источника данные первой страницы и подгружает
// новые, если надо. Запрос `q` живёт в extra пагинатора (адрес
// `?<pageParam>.q`), `reloadKeys: ['q']` сбрасывает выдачу на первую страницу.
// Несколько поисков на странице — разные name/pageParam.
import type { Extra } from '$lib/paginate/types'
import type { AdaptedSource } from '$lib/paginate'
import type { ExtraSearchSpec } from '$lib/paginate'
import type { SearchFuzzyOptions } from './accumulator'

export type SearchConfig<T> = {
  /** Уникальное имя поиска; оно же — имя пагинатора (R17: deny by default). */
  name: string
  /**
   * Адаптированный источник пагинатора (defineSource). Поиск подменяет его
   * страницу перехватчиком. Источник обязан понимать `extra.q` НА СЕРВЕРЕ как
   * точное/подстрочное сужение — это контур SSR/no-JS; `q` — отдельное поле
   * транспорта, никогда не значение фильтров. Спецификацию fuzzy источник
   * объявляет сам (`search.fuzzy`); источник без неё работает как есть.
   */
  source: AdaptedSource<T>
  /**
   * Базовый ключ адреса: `?<pageParam>=N`, `?<pageParam>.q=строка`.
   * По умолчанию — name. Два поиска на странице обязаны отличаться ключом.
   */
  pageParam?: string
  /** Размер страницы пагинатора. @default 20 */
  pageSize?: number
  /** Минимальная длина запроса (короче — сквозной проход без сужения). @default 2 */
  minLength?: number
  /** Дебаунс живого ввода в мс (JS-усиление; GET-форма работает и без него). @default 300 */
  debounce?: number
  /** Максимальная длина запроса в адресе (deny-safe обрезка). @default 120 */
  maxQueryLength?: number
  /**
   * Дополнительные ключи адреса пагинатора (`?<pageParam>.<key>`), например
   * фильтры источника. lib search их не трактует: они принадлежат ИСТОЧНИКУ
   * и проходят сквозь перехват в каждый его вызов (цепочка не рвётся —
   * фильтры работают с источником и до, и после перехвата).
   */
  extraSearch?: ExtraSearchSpec
  /** Дефолты дополнительных ключей (для чистых URL и back/forward). */
  extraDefaults?: Extra
  /** Ключи extra, смена которых перезагружает выдачу (дополнительно к `q`). */
  reloadKeys?: readonly string[]
}

export type SearchInstance = {
  name: string
  pageParam: string
  queryKey: string
  minLength: number
  debounce: number
  maxQueryLength: number
}
