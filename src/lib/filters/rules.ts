/**
 * Связки фильтров: что схема ЗАПРЕЩАЕТ сочетать.
 *
 * Схема отвечает не только за состав полей, но и за совместимость: «поиск под
 * этим фильтром не работает», «эти два фильтра вместе всегда дают пустую
 * выдачу». Связки объявляет зона источника (они — знание об API, а не о UI),
 * а применяют их оба мира одной и той же чистой функцией:
 *
 *   • источник — deny-safe: несовместимый фильтр/поиск не доезжает до запроса
 *     (уже объявленную причину видит UI, а не «тихое отбрасывание»);
 *   • форма/панель — заранее: гасит поле и показывает `reason`.
 *
 * Здесь же живёт одна связка, которую не надо объявлять в схеме: она следует из
 * СМЫСЛА режимов. Значение, выбранное и в «все из», и в «кроме», не может
 * совпасть ни с чем — это свойство `and`/`not`, а не особенность источника.
 */
import {
  catalogFilterFieldNames,
  parseCatalogFilterPath,
  type CatalogFilterCondition,
  type CatalogFilterRule,
  type CatalogFilterSchema,
} from './catalog-filter'

/** Значения фильтров «как из адреса»: путь поля → список значений. */
export type CatalogFilterValueMap = Readonly<Record<string, readonly string[]>>

/** Нарушение связки: что столкнулось, почему и что из-за этого не применяется. */
export type CatalogFilterViolation = {
  /** Имя связки: `search-with-latest` (правило схемы) или `contradictory-modes`. */
  id: string
  /** Человекочитаемая причина — её показывает интерфейс. */
  message: string
  /** Канонические ключи столкнувшихся значений: `filters.genres.not=133`. */
  keys: readonly string[]
  /**
   * Что не применяется из-за связки: `'q'` — поиск, `{ field }` — фильтр схемы.
   * Пусто — сочетание просто невозможно (deny-safe нечего отбрасывать: форма
   * такое не пропускает, а источник честно вернёт пустую выдачу).
   */
  drop?: 'q' | { field: string }
}

/** Значения одного пути без пустых строк. */
function valuesAt(values: CatalogFilterValueMap, path: string): readonly string[] {
  return (values[path] ?? []).filter((item) => item !== '')
}

/** Выполнено ли условие связки: поле заполнено (и, если указано, этим значением). */
function conditionMet(
  schema: CatalogFilterSchema,
  values: CatalogFilterValueMap,
  condition: CatalogFilterCondition,
): boolean {
  const descriptor = schema.fields.find((field) => field.key === condition.field)
  if (!descriptor) return false
  const paths = catalogFilterFieldNames(descriptor)
  if (condition.value === undefined) return paths.some((path) => valuesAt(values, path).length > 0)
  return paths.some((path) => valuesAt(values, path).includes(condition.value!))
}

/** Сработавшая связка «поиск запрещён»: её причина объясняет, почему `q` не применяется. */
export function catalogFilterSearchRule(
  schema: CatalogFilterSchema | undefined,
  values: CatalogFilterValueMap,
): CatalogFilterRule | undefined {
  return (schema?.rules ?? []).find(
    (rule) => rule.drop === 'q' && rule.when.every((condition) => conditionMet(schema!, values, condition)),
  )
}

/**
 * Поля, которые при текущих значениях НЕ ПРИМЕНЯЮТСЯ (deny-safe решение
 * источника). Отдельно от `q`: у поиска свой канал (`catalogFilterSearchRule`),
 * потому что UI гасит именно поле запроса.
 */
export function catalogFilterSuppressedFields(
  schema: CatalogFilterSchema | undefined,
  values: CatalogFilterValueMap,
): Set<string> {
  const out = new Set<string>()
  for (const rule of schema?.rules ?? []) {
    if (rule.drop === 'q') continue
    if (rule.when.every((condition) => conditionMet(schema!, values, condition))) out.add(rule.drop.field)
  }
  return out
}

/**
 * Значение выбрано и в «все из», и в «кроме» одного поля: пересечение `and` и
 * `not` не может совпасть ни с чем. Возвращает по нарушению на каждое общее
 * значение (это подсказка форме, а не запрет запросу: API честно вернёт пусто).
 */
export function contradictoryModeViolations(
  schema: CatalogFilterSchema | undefined,
  values: CatalogFilterValueMap,
): CatalogFilterViolation[] {
  const out: CatalogFilterViolation[] = []
  for (const descriptor of schema?.fields ?? []) {
    const modes = descriptor.modes ?? ['or']
    if (!modes.includes('and') || !modes.includes('not')) continue
    const required = new Set(valuesAt(values, `filters.${descriptor.key}.and`))
    const excluded = valuesAt(values, `filters.${descriptor.key}.not`)
    const label = (value: string) =>
      descriptor.options?.find((option) => option.value === value)?.label ?? value
    for (const value of excluded) {
      if (!required.has(value)) continue
      out.push({
        id: 'contradictory-modes',
        message: `«${descriptor.label}»: «${label(value)}» выбрано и в «все из», и в «кроме» — выдача будет пустой`,
        keys: [`filters.${descriptor.key}.and=${value}`, `filters.${descriptor.key}.not=${value}`],
      })
    }
  }
  return out
}

/**
 * Все нарушения связок при текущих значениях: объявленные схемой и вытекающие
 * из смысла режимов. Форма показывает их до отправки; источник — применяет
 * `drop` deny-safe.
 */
export function checkCatalogFilterRules(
  schema: CatalogFilterSchema | undefined,
  values: CatalogFilterValueMap,
): CatalogFilterViolation[] {
  const out: CatalogFilterViolation[] = []
  for (const rule of schema?.rules ?? []) {
    if (!rule.when.every((condition) => conditionMet(schema!, values, condition))) continue
    const keys = rule.when.map((condition) =>
      condition.value === undefined
        ? `filters.${condition.field}`
        : `filters.${condition.field}=${condition.value}`,
    )
    out.push({ id: rule.id, message: rule.reason, keys, drop: rule.drop })
  }
  out.push(...contradictoryModeViolations(schema, values))
  return out
}

/** Значения из адреса/extra → карта путей (то, что читают связки). */
export function catalogFilterValueMap(source: Record<string, unknown> | undefined): CatalogFilterValueMap {
  const out: Record<string, readonly string[]> = {}
  for (const [path, raw] of Object.entries(source ?? {})) {
    if (!path.startsWith('filters.') || !parseCatalogFilterPath(path)) continue
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [raw]
    const items = list
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0 && item.length <= 120)
    if (items.length) out[path] = items
  }
  return out
}
