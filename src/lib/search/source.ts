/**
 * Подключение поиска к АДАПТИРОВАННОМУ источнику пагинатора (декоратор).
 *
 * lib search не знает ни одного конкретного источника: он берёт спецификацию
 * усиления у самого источника (`searchFor(extra).fuzzy`) и оборачивает его
 * страницу перехватчиком. Поэтому:
 *   • источник без родного поиска усилить нельзя — возможностей нет, декоратор
 *     просто пропускает запрос в источник (UI это увидит и выключит поиск);
 *   • «поиск выключен» (`searchFor(extra).enabled === false`) уважается ДО
 *     перехватчика: выключенный запрос не превращается в fuzzy-сканирование;
 *   • у переключателя источников у каждого выбора своя спецификация → свой
 *     аккумулятор (WeakMap по объекту спецификации), буферы не смешиваются.
 */
import {
  assertAdaptedSource,
  defineSource,
  type AdaptedSource,
  type Extra,
} from '$lib/paginate'
import type { Source } from '$lib/paginate/types'
import type { SourceCorrectionInfo } from '$lib/paginate'
import { createSearchInterceptor, type SearchCorrectionInfo } from './accumulator'
import { reportSearchCorrection, reportSearchStats } from './registry'

export type WithSearchOptions = {
  /** Имя поиска (= имя пагинатора): под ним живут подпись коррекции и статистика. */
  name: string
  /**
   * Политика приложения: включено ли усиление при таком extra (демо-тумблер
   * «lib/search»). Выключено — запрос уходит источнику как есть (родной поиск).
   * @default включено всегда
   */
  active?: (extra: Extra) => boolean
  /**
   * Корректор опечаток —дело ПОИСКА, а не источника (словарь и его артефакт
   * принадлежат поисковой части). Возвращается по текущему extra: у разных
   * источников переключателя свои словари. `undefined` — коррекции нет,
   * аккумулятор уйдёт на запасной контур (сканирование).
   */
  correct?: (
    extra: Extra,
  ) => ((query: string) => Promise<SourceCorrectionInfo | null>) | undefined
  /** Минимальная длина запроса, если источник не задал свою. @default 2 */
  minLength?: number
}

/**
 * Оборачивает источник перехватчиком поиска и возвращает СНОВА адаптированный
 * источник: возможности, ключи данных и спецификации сохраняются, меняется
 * только страница. Ставить в пагинатор обычную функцию-обёртку нельзя — пагинатор
 * принимает лишь то, что создано слоем источника.
 */
export function withSearch<T>(source: AdaptedSource<T>, options: WithSearchOptions): AdaptedSource<T> {
  assertAdaptedSource<T>(source, `withSearch("${options.name}")`)
  const base: Source<T> = (req) => source.page(req)
  /** Аккумулятор на каждую спецификацию усиления (у переключателя — на выбор). */
  const interceptors = new WeakMap<object, Source<T>>()

  return defineSource<T>({
    ...source.definition,
    page: async (req) => {
      const extra = req.extra ?? {}
      const spec = source.searchFor(extra)
      const enabled = spec?.enabled ? spec.enabled(extra) : true
      const fuzzy = enabled && spec?.fuzzy ? spec.fuzzy : undefined
      if (!fuzzy || (options.active && !options.active(extra))) {
        // Усиление не в цепочке: сквозной проход к источнику (родной поиск/каталог),
        // живые счётчики гаснут. Подпись коррекции НЕ трогаем — панель прячет её
        // по возможностям/флагам, а реестр обновится сам при следующем усилении.
        reportSearchStats(options.name, null)
        return base(req)
      }
      let interceptor = interceptors.get(fuzzy)
      if (!interceptor) {
        const correct = options.correct?.(extra)
        interceptor = createSearchInterceptor<T>({
          ...fuzzy,
          ...(correct ? { correct } : {}),
          source: base,
          minLength: spec?.minLength ?? options.minLength ?? 2,
          onCorrection: (info: SearchCorrectionInfo | null) =>
            reportSearchCorrection(options.name, info),
          onStats: (stats) => reportSearchStats(options.name, stats),
        })
        interceptors.set(fuzzy, interceptor)
      }
      return interceptor(req)
    },
  })
}
