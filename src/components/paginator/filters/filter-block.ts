/**
 * Какой ключ схемы закрывает блок нарезки.
 *
 * Имена контролов уже написаны в UI. Схема — та же, что у формы: подпись
 * метки живёт в ней, блок её не задаёт. Ноль ключей — метки нет. Больше
 * одного — блок не нарезан: иначе две метки открывали бы один и тот же UI.
 */
import { FILTER_KEY_PREFIX } from '#lib/paginate/index.js'
import { parseCatalogFilterPath, type CatalogFilterSchema } from '#lib/paginate/filters/index.js'

export type FilterBlockCut = { key: string; label: string } | { key: null; reason: 'empty' | 'mixed' }

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
