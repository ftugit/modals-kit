/**
 * Механика универсальной демо-панели: схема → форма → адрес → параметры.
 *
 * Всё, что раньше каждая страница писала руками (seed из `?параметров`, сборка
 * href, какие умолчания не писать, что снимается при смене сценария), здесь
 * выводится из схемы. Панель (`DemoPanel.svelte`) — только разметка и связка с
 * адресным писателем.
 */
import { defineForm, field, policyWith, type FieldDraft, type FormDescription } from '#lib/form/index.js'
import type { DemoSchemaData, DemoField, DemoPanelSchema, DemoValues } from './types.js'

/** Поля схемы без разделителей — в порядке вывода. */
export function demoFields(schema: DemoSchemaData): readonly DemoField[] {
  return schema.fields.filter((f): f is DemoField => f.type !== 'divider')
}

/** Ключ адреса поля; `null` — поле живёт только в параметрах потребителя. */
export function demoUrlKey(f: DemoField): string | null {
  if (f.url === false) return null
  return f.url?.key ?? f.key
}

/** Значения по умолчанию — как их прочтёт пустой адрес. */
export function demoDefaults(schema: DemoSchemaData): DemoValues {
  const out: DemoValues = {}
  for (const f of demoFields(schema)) out[f.key] = f.defaultValue
  return out
}

/** Источник адреса: `URL`, строка или адрес страницы SvelteKit (`ReadonlyURLSearchParams`). */
export type DemoUrlSource =
  | string
  | URL
  | { readonly searchParams: { getAll(name: string): string[]; get(name: string): string | null } }

/**
 * Прочитать значения из адреса (SSR, no-JS, F5). Умолчания действуют, когда
 * ключа нет; невалидный вариант списка откатывается к умолчанию; тумблер
 * читается как «есть ли `true` среди значений» (hidden-пара + чекбокс).
 */
export function demoParams<V extends DemoValues>(
  schema: DemoPanelSchema<V>,
  url: DemoUrlSource,
): V {
  const sp = typeof url === 'string' ? new URL(url, 'http://demo.invalid').searchParams : url.searchParams
  const out: DemoValues = {}
  for (const f of demoFields(schema)) {
    const key = demoUrlKey(f)
    if (key === null) {
      out[f.key] = f.defaultValue
      continue
    }
    const all = sp.getAll(key)
    // Нативный чекбокс без JS шлёт «on» (значение `value` у Switch не доезжает),
    // поэтому включённость — любой из «true»/«on»; hidden-пара даёт «false» рядом.
    if (f.type === 'toggle')
      out[f.key] =
        all.length === 0 ? f.defaultValue : all.some((v) => v === 'true' || v === 'on')
    else if (f.type === 'select') {
      const raw = all[0]
      out[f.key] = raw !== undefined && f.options.some((o) => o.value === raw) ? raw : f.defaultValue
    } else out[f.key] = all[0] ?? f.defaultValue
  }
  return out as V
}

/** Значение поля строкой адреса. */
function urlValue(f: DemoField, raw: unknown): string {
  if (f.type === 'toggle') return raw === true ? 'true' : 'false'
  const v = raw === undefined || raw === null ? '' : String(raw)
  return v === '' ? f.defaultValue : v
}

/**
 * Адрес с значениями панели.
 *
 * `resetScenario` — смена сценарного поля: адрес пересобирается из полей панели,
 * чужие ключи сценария снимаются (иначе — живут: панель трогает только своё).
 */
export function demoHref<V extends DemoValues>(
  schema: DemoPanelSchema<V>,
  values: Readonly<Record<string, unknown>>,
  current: URL | string,
  options: { resetScenario?: boolean } = {},
): string {
  const base = typeof current === 'string' ? new URL(current, 'http://demo.invalid') : current
  const sp = new URLSearchParams(options.resetScenario === true ? '' : base.search)
  for (const f of demoFields(schema)) {
    const key = demoUrlKey(f)
    if (key === null) continue
    const value = urlValue(f, values[f.key])
    const omit = f.url !== false && f.url?.omitWhenDefault === true
    if (omit && value === String(f.defaultValue)) sp.delete(key)
    else sp.set(key, value)
  }
  const qs = sp.toString()
  return `${base.pathname}${qs ? `?${qs}` : ''}`
}

/** Имя сценарного поля, изменившегося между двумя наборами (null — нет). */
export function demoScenarioChange<
  V extends DemoValues,
  W extends Record<string, unknown>,
>(schema: DemoPanelSchema<V>, before: W, after: W): DemoField | null {
  for (const f of demoFields(schema)) {
    if (f.resetsScenario !== true) continue
    if (String(before[f.key] ?? '') !== String(after[f.key] ?? '')) return f
  }
  return null
}

/**
 * Язык имён панели: ключи — КЛЮЧИ АДРЕСА (`page.colW`, `gallery.size`).
 * У пагинатора сегменты camelCase — их задаёт источник extra; политика форм
 * по умолчанию такие имена отвергает (язык приложения ≠ язык адреса).
 */
const DEMO_PANEL_POLICY = policyWith({ names: { pattern: /^[a-z][a-zA-Z0-9_]{0,31}$/ } })

const formCache = new WeakMap<DemoSchemaData, FormDescription>()

/** Описание формы панели из схемы (одно на схему). */
export function demoForm(schema: DemoSchemaData): FormDescription {
  const cached = formCache.get(schema)
  if (cached) return cached
  const fields: Record<string, FieldDraft<never>> = Object.create(null)
  for (const f of demoFields(schema)) {
    const common = { label: f.label, ...(f.hint !== undefined ? { help: f.hint } : {}) }
    fields[f.key] =
      f.type === 'select'
        ? (field.select({
            ...common,
            defaultValue: f.defaultValue,
            options: f.options.map((o) => ({ value: o.value, label: o.label })),
          }) as FieldDraft<never>)
        : f.type === 'toggle'
          ? (field.checkbox({ ...common, defaultValue: f.defaultValue }) as FieldDraft<never>)
          : (field.text({ ...common, defaultValue: f.defaultValue }) as FieldDraft<never>)
  }
  const desc = defineForm({
    id: schema.id,
    revision: 1,
    actions: [{ id: 'apply', label: 'Применить', validate: 'none' }],
    fields,
    policy: DEMO_PANEL_POLICY,
  })
  formCache.set(schema, desc)
  return desc
}
