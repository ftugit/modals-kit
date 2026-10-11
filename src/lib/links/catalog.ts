/**
 * Словарь связок ФИЛЬТРОВ каталога поверх нейтрального ядра `./links` —
 * ЕДИНСТВЕННЫЙ движок связок фильтров (C6): живая форма, картина панели и
 * серверная deny-safe защита спрашивают одно и то же здесь.
 *
 * Переводит язык схемы на язык ядра и обратно:
 *   • `drop: { field }` → `disable-field` по ключу поля;
 *   • `drop: 'q'` → `disable-field` по идентификатору `#q` (`CATALOG_SEARCH_LINK`;
 *     ключ поля схемы обязан начинаться с буквы, поэтому совпасть не может):
 *     поиск живёт вне формы (решение оператора §4.1), но связку считает тот же
 *     расчёт — у поиска лишь свой канал показа (`searchBlocked`, `search`);
 *   • противоречие режимов (одно значение в «все из» и в «кроме») связка не
 *     объявляет: оно СЛЕДУЕТ из смысла, поэтому правила синтезуются из
 *     текущих значений (`disable-option`). Это подсказка, а не запрет: поле
 *     не гаснет, источник ничего не отбрасывает — честно вернёт пусто;
 *   • идентификаторы условий — ключи полей (`score`) и пути-срез (`score.min`,
 *     `genres.and`): ядро читает их через `catalogLinkValues` (поле заполнено,
 *     если заполнен любой его путь; значение — если есть на любом пути).
 */
import {
  catalogFilterFieldNames,
  catalogFilterValueMap,
  parseCatalogFilterPath,
  type CatalogFilterSchema,
  type CatalogFilterValueMap,
  type CatalogFilterViolation,
} from '#lib/filters/catalog-filter.js'
import {
  computeLinks,
  linkFieldState,
  linkHelperText,
  linkRefusalText,
  type LinkFieldDecision,
  type LinkFiring,
  type LinkLabel,
  type LinkOutcome,
  type LinkRule,
  type LinkValues,
} from './links'

/** Идентификатор поиска в словаре: `drop: 'q'` схемы гасит именно его. */
export const CATALOG_SEARCH_LINK = '#q'

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
    rules.push({
      id: rule.id,
      reason: rule.reason,
      when: rule.when.map((condition) => ({
        field: condition.field,
        ...(condition.value === undefined ? {} : { value: condition.value }),
      })),
      effect: { kind: 'disable-field', field: rule.drop === 'q' ? CATALOG_SEARCH_LINK : rule.drop.field },
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
        reason: `«${field.label}»: «${nameOf(value)}» выбрано и в «все из», и в «кроме» — выдача будет пустой`,
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

/** Подписи для текстов: ключ поля → его `label`. */
export function catalogLinkLabel(schema: CatalogFilterSchema): LinkLabel {
  const labels = new Map(schema.fields.map((field) => [field.key, field.label]))
  return (id) => labels.get(id) ?? id
}

/**
 * Строка под погашенным полем. У ПУСТОЙ жертвы — helper «кто мешает»
 * (`«Статус» блокирует поле: …`); если значение уже стоит (мир без JS,
 * расшаренный адрес, выбор до блокировки) — отказ набора: с этим значением он
 * не применится (§7.5). Формулировку отказа делит валидатор (`link.blocked`).
 */
export function catalogLinkReason(
  schema: CatalogFilterSchema,
  map: CatalogFilterValueMap,
  firing: LinkFiring,
  key: string,
): string {
  const label = catalogLinkLabel(schema)
  const field = schema.fields.find((item) => item.key === key)
  const filled = field !== undefined && catalogFilterFieldNames(field).some((path) => (map[path]?.length ?? 0) > 0)
  return filled ? linkRefusalText(key, firing.blockers, label) : linkHelperText(firing, label)
}

/**
 * Пояснения к сработавшим связкам — картина панели и серверная проверка.
 * Ключи — канонические: `filters.status=anons`, `filters.genres.not=133`.
 */
export function catalogLinkViolations(outcome: LinkOutcome): CatalogFilterViolation[] {
  return outcome.firings.map(({ rule }) => {
    const keys = rule.when.map((condition) =>
      condition.value === undefined
        ? `filters.${condition.field}`
        : `filters.${condition.field}=${condition.value}`,
    )
    const drop: CatalogFilterViolation['drop'] = rule.effect.kind !== 'disable-field'
      ? undefined
      : rule.effect.field === CATALOG_SEARCH_LINK ? 'q' : { field: rule.effect.field }
    return { id: rule.id, message: rule.reason, keys, ...(drop ? { drop } : {}) }
  })
}

/**
 * Канал `fieldState` формы фильтров: имена контролов адресные
 * (`page.filters.score.min`), значения — живое зеркало формы. Поле гаснет
 * целиком (все его пути), строка — `catalogLinkReason`.
 */
export function catalogLinkFieldState(
  schema: CatalogFilterSchema,
  namePrefix = '',
): (name: string, values: Readonly<Record<string, unknown>>) => LinkFieldDecision | undefined {
  return linkFieldState(
    (values: Readonly<Record<string, unknown>>) => {
      const own: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(values)) {
        if (name.startsWith(namePrefix)) own[name.slice(namePrefix.length)] = value
      }
      const map = catalogFilterValueMap(own)
      return { map, outcome: catalogLinkOutcome(schema, map) }
    },
    (name) => (name.startsWith(namePrefix) ? parseCatalogFilterPath(name.slice(namePrefix.length))?.key : undefined),
    (firing, key, { map }) => catalogLinkReason(schema, map, firing, key),
  )
}
