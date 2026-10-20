// Умолчания описания как ЗНАЧЕНИЯ формы.
//
// До хода 269 `defaultValue` жил только в атрибуте разметки (`valueAttrs`):
// `Select` умолчание не показывал (берёт `f.value`), а стёртое текстовое поле
// возвращало умолчание в `value` — очистить его было нельзя. Теперь начальные
// значения формы собираются здесь один раз, а разметка дублировать умолчание
// перестала.
import type { FormDescription } from './describe'

/**
 * Начальные значения формы из умолчаний описания.
 * @param d Описание формы.
 * @returns Значения по имени поля; поля без умолчания отсутствуют.
 */
export function defaultValueMap(d: FormDescription): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of d.fields) if (f.defaultValue !== undefined) out[f.name] = f.defaultValue
  return out
}
