/**
 * Svelte 5-адаптер связок — только разметка (как `$lib/search/svelte`):
 * расчёт, тексты и сборка живут в ядре `../links`, здесь — реактивность.
 *
 * Хук НЕ владенец состояния: значения приносит потребитель (extra
 * пагинатора, форма панели) двумя геттерами; пересчёт — обычный `$derived`
 * по их зависимостям. Никакой записи: связки решают ПОКАЗАНИЕ, а исходные
 * значения формы остаются нетронутыми (разблокировка возвращает их сама).
 */
import {
  computeLinks, linkHelperText, type LinkOutcome, type LinkRule, type LinkValues, type LinkLabel,
} from '../links'

export type LinkEffectsView = {
  /** Полный ответ расчёта: firings — источник предупреждений и отказов. */
  outcome: () => LinkOutcome
  /** Текст helper'а выключенного поля; `undefined` — поле свободно. */
  helper: (field: string) => string | undefined
  /** Значения, выключенные внутри поля (список гасит опции). */
  disabledOptions: (field: string) => ReadonlySet<string> | undefined
}

/**
 * Живые связки над чужим состоянием. `rules()` и `read()` — геттеры
 * потребителя: пока их зависимости меняются, результат меняется сам.
 */
export function useLinkEffects(
  rules: () => readonly LinkRule[],
  read: LinkValues,
  label: LinkLabel,
): LinkEffectsView {
  const outcome = $derived(computeLinks(rules(), read))
  return {
    outcome: () => outcome,
    helper: (field) => {
      const firing = outcome.fields.get(field)
      return firing ? linkHelperText(firing, label) : undefined
    },
    disabledOptions: (field) => outcome.options.get(field),
  }
}
