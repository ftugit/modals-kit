/**
 * Словарь связок ФИЛЬТРОВ каталога поверх нейтрального ядра `./links`.
 *
 * Переводит язык схемы на язык ядра и обратно:
 *   • `drop: { field }`  → `disable-field`; `drop: 'q'` НЕ переводится —
 *     поиск живёт вне формы (решение оператора §4.1) и остаётся в своём
 *     канале `catalogFilterSearchRule`;
 *   • противоречие режимов (одно значение в «все из» и в «кроме») связка не
 *     объявляет: оно СЛЕДУЕТ из смысла, поэтому правила синтезуются из
 *     текущих значений — недоступным становится ЗНАЧЕНИЕ в обоих списках,
 *     выбор сохраняется, в набор не попадает;
 *   • идентификаторы условий — ключи полей (`score`) и пути-срез (`score.min`,
 *     `genres.and`): ядро читает их через `catalogLinkValues`, совпадая с
 *     семантикой `conditionMet` из `lib/filters/rules.ts` (поле заполнено,
 *     если любое имя режима заполнено; значение — если есть на любом пути).
 *
 * Паритет с `lib/filters/rules.ts` обязателен и покрыт тестом: этот слой —
 * будущий единственный движок живого режима (этап 5), а сегодня обязан
 * отвечать ровно то же, что отвечал движок схемы.
 */
import {
  catalogFilterFieldNames,
  type CatalogFilterSchema,
} from '$lib/filters/catalog-filter'
import type { CatalogFilterValueMap } from '$lib/filters/rules'
import { computeLinks, type LinkOutcome, type LinkRule, type LinkValues } from './links'

/** Ключ → пути поля; срез `ключ.режим/граница` сужает список путей. */
function pathsOf(schema: CatalogFilterSchema): (id: string) => readonly string[] {
  const byKey = new Map(schema.fields.map((field) => [field.key, catalogFilterFieldNames(field)]))
  return (id) => {
    const dot = id.indexOf('.')
    const key = dot < 0 ? id : id.slice(0, dot)
    const names = byKey.get(key)
    if (!names) return []
    return dot < 0 ? names : names.filter((path) => path.endsWith(id.slice(dot)))
  }
}

/** Идентификатор словаря → значения поля (union по путям) или срез одного пути. */
export function catalogLinkValues(
  schema: CatalogFilterSchema,
  map: CatalogFilterValueMap,
): LinkValues {
  const paths = pathsOf(schema)
  return (id) => {
    const out: string[] = []
    for (const path of paths(id)) out.push(...(map[path] ?? []))
    return out
  }
}

/**
 * Правила схемы + синтез противоречий — в нейтральных `LinkRule`.
 * `map` нужен синтезу: он смотрит, что ВЫБРАНО сейчас, а что объявлено —
 * лежит в схеме неподвижно.
 */
export function catalogLinkRules(
  schema: CatalogFilterSchema,
  map: CatalogFilterValueMap,
): readonly LinkRule[] {
  const rules: LinkRule[] = []
  for (const rule of schema.rules ?? []) {
    if (rule.drop === 'q') continue
    rules.push({
      id: rule.id,
      reason: rule.reason,
      when: rule.when.map((condition) => ({
        field: condition.field,
        ...(condition.value === undefined ? {} : { value: condition.value }),
      })),
      effect: { kind: 'disable-field', field: rule.drop.field },
    })
  }
  for (const field of schema.fields) {
    const modes = field.modes ?? []
    if (!modes.includes('and') || !modes.includes('not')) continue
    const required = map[`filters.${field.key}.and`] ?? []
    const excluded = map[`filters.${field.key}.not`] ?? []
    const nameOf = (value: string): string =>
      field.options?.find((option) => option.value === value)?.label ?? value
    for (const value of new Set(excluded)) {
      if (!required.includes(value)) continue
      rules.push({
        id: 'contradictory-modes',
        reason: `«${nameOf(value)}» выбрано и в «все из», и в «кроме» — выдача будет пустой`,
        when: [
          { field: `${field.key}.and`, value },
          { field: `${field.key}.not`, value },
        ],
        effect: { kind: 'disable-option', field: field.key, value },
      })
    }
  }
  return rules
}

/** Полный ответ связок на текущие значения: расчёт правил + чтение значений. */
export function catalogLinkOutcome(
  schema: CatalogFilterSchema,
  map: CatalogFilterValueMap,
): LinkOutcome {
  return computeLinks(catalogLinkRules(schema, map), catalogLinkValues(schema, map))
}

/**
 * Набор фильтров без выключенного: путь → значения. Числовые границы и
 * запятые — формат адресного слоя, сюда он приходит картой путей; сборка
 * трогает только состав значений (сегодня это делает `catalogFilterExtraPatch`
 * — после этапа 5 он зовёт именно эту функцию).
 */
export function catalogLinkSet(
  schema: CatalogFilterSchema,
  map: CatalogFilterValueMap,
  outcome: LinkOutcome,
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {}
  for (const field of schema.fields) {
    if (outcome.fields.has(field.key)) continue
    const off = outcome.options.get(field.key)
    for (const path of catalogFilterFieldNames(field)) {
      const kept = (map[path] ?? []).filter((value) => !off?.has(value))
      if (kept.length) out[path] = kept
    }
  }
  return out
}
