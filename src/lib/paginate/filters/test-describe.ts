/**
 * Только для тестов: описание формы со ВСЕМИ полями схемы через `filterParams` —
 * так, как написало бы его приложение, если бы рисовало всё подряд. Подпись —
 * подпись схемы. В пакет не экспортируется.
 */
import { defineForm, field, type FieldDraft, type FormDescription } from '#lib/form/index.js'
import { FILTER_KEY_PREFIX } from '../source'
import { filterParams, type CatalogFilterFormOptions, type FilterFieldParams } from './params'
import { catalogFilterFieldNames, validateCatalogFilterSchema, type CatalogFilterSchema } from './schema'
import { parseCatalogFilterPath } from './url'

export function describeAll(input: CatalogFilterSchema, opts?: CatalogFilterFormOptions): FormDescription {
  const schema = validateCatalogFilterSchema(input)
  const filter = filterParams(schema, opts)
  const drafts: Record<string, FieldDraft<any>> = {}
  for (const descriptor of schema.fields) {
    for (const path of catalogFilterFieldNames(descriptor)) {
      const parsed = parseCatalogFilterPath(path)!
      const own = filter[descriptor.key]!
      const params: FilterFieldParams = parsed.mode ? own[parsed.mode] : parsed.bound ? own[parsed.bound] : own
      const label = descriptor.label
      drafts[path.slice(FILTER_KEY_PREFIX.length)] =
        descriptor.type === 'multiselect'
          ? field.multiselect({ label, ...params })
          : descriptor.type === 'select'
            ? field.select({ label, ...params })
            : descriptor.type === 'number'
              ? field.number({ label, ...params })
              : field.text({ label, ...params })
    }
  }
  return defineForm({ id: 'test-filters', policy: filter.policy, fields: filter.fields(drafts) })
}
