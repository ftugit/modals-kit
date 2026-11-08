/**
 * Какой ключ закрывает блок нарезки.
 *
 * Имена контролов уже написаны в UI. Подпись живёт в схеме каталога или в
 * описании формы списка, блок её не задаёт. Ноль ключей — метки нет. Больше
 * одного — блок не нарезан: иначе две метки открывали бы один и тот же UI.
 */
import { FILTER_KEY_PREFIX } from '#lib/paginate/index.js'
import { parseCatalogFilterPath, type CatalogFilterSchema } from '#lib/paginate/filters/index.js'

export type FilterBlockCut = { key: string; label: string } | { key: null; reason: 'empty' | 'mixed' }

export type FilterCutSource = {
  schema?: CatalogFilterSchema | null
  prefix?: string
  /** Имя поля или ключ чипа → подпись. */
  labels?: Readonly<Record<string, string>>
  /** Имя поля → ключ чипа, если упаковка не совпадает с именем (`sc.login` → `scopes`). */
  aliases?: Readonly<Record<string, string>>
}

export function filterBlockCut(
  names: readonly string[],
  schema: CatalogFilterSchema,
  prefix = '',
): FilterBlockCut {
  const known = new Map(schema.fields.map((field) => [field.key, field.label]))
  const layer = prefix ? `${prefix}.` : ''
  const keys = new Set<string>()
  for (const name of names) {
    if (!name) continue
    const path = layer && name.startsWith(layer) ? name.slice(layer.length) : name
    if (!path.startsWith(FILTER_KEY_PREFIX)) continue
    const parsed = parseCatalogFilterPath(path)
    if (!parsed || !known.has(parsed.key)) continue
    keys.add(parsed.key)
  }
  if (keys.size === 0) return { key: null, reason: 'empty' }
  if (keys.size > 1) return { key: null, reason: 'mixed' }
  const key = [...keys][0]!
  return { key, label: known.get(key) ?? key }
}

/** Имя поля формы. Чужое имя пропускается. Несколько разных ключей — не нарезка. */
export function filterFieldCut(
  names: readonly string[],
  labels: Readonly<Record<string, string>>,
  aliases: Readonly<Record<string, string>> = {},
  prefix = '',
): FilterBlockCut {
  const layer = prefix ? `${prefix}.` : ''
  const keys = new Set<string>()
  for (const name of names) {
    if (!name) continue
    const path = layer && name.startsWith(layer) ? name.slice(layer.length) : name
    const aliased = aliases[path]
    const key = aliased ?? (Object.prototype.hasOwnProperty.call(labels, path) ? path : null)
    if (!key) continue
    keys.add(key)
  }
  if (keys.size === 0) return { key: null, reason: 'empty' }
  if (keys.size > 1) return { key: null, reason: 'mixed' }
  const key = [...keys][0]!
  return { key, label: labels[key] ?? key }
}

/**
 * Схема каталога — если путь её знает. Иначе имя поля формы.
 * Смешанная схема не падает в поля: два ключа схемы так и остаются двумя.
 */
export function resolveFilterBlockCut(names: readonly string[], source: FilterCutSource): FilterBlockCut {
  if (source.schema) {
    const catalog = filterBlockCut(names, source.schema, source.prefix ?? '')
    if (catalog.key !== null || catalog.reason === 'mixed') return catalog
  }
  if (source.labels && Object.keys(source.labels).length > 0) {
    return filterFieldCut(names, source.labels, source.aliases ?? {}, source.prefix ?? '')
  }
  return { key: null, reason: 'empty' }
}
