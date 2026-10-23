/**
 * Панель настроек пагинатора на универсальном `DemoPanel` (этап 2).
 *
 * `SettingsField[]` (данные пагинатора) → схема универсальной панели:
 *
 *   • имена полей — КАНОНИЧЕСКИЕ ключи адреса (`page.cols`, `gallery.size`):
 *     панель без JS отправляет их нативным GET, а адаптер источника читает
 *     обратно; переименовать — значит разойтись с no-JS-путём и с тестами;
 *   • все поля `url: false` — адрес пишет адаптер пагинатора (он владеет
 *     ключами `page`/`page.*`), панель только отдаёт ПАРАМЕТРЫ;
 *   • `enabledBy` (данные) → `disabledWhen` поля: «доступно при X=a» ==
 *     «выключено при прочих значениях X» по ЗАКРЫТОМУ списку вариантов;
 *   • `requires` (возможности источника, серверные данные) гасит поле
 *     статически с причиной — она же подсказка.
 *
 * Компилятор не строит форму: форму ведёт `DemoPanel`. Здесь — только
 * данные и мапперы «значения панели → патч хранилища» и обратно.
 */
import type { ExtraValue, FeatureGate } from '#lib/paginate/index.js'
import {
  demoDivider,
  demoSelect,
  demoToggle,
  type DemoFieldSpec,
  type DemoPanelSchema,
  type DemoValues,
} from '#components/demo/index.js'
import type { SettingsField } from './types'

/** Подписи возможностей для причины «источник не поддерживает …». */
export const GATE_LABEL: Record<FeatureGate, string> = {
  nativeSearch: 'родной поиск',
  libSearch: 'paginate/search',
  filters: 'фильтры',
  totals: 'число страниц',
  dictionary: 'словарь опечаток',
}

export interface PaginatorPanelInput<V extends Record<string, ExtraValue>> {
  /** Префикс ключей пагинатора в адресе (`page`, `gallery`). */
  pageParam: string
  /** Адрес нативной GET-формы без JavaScript. */
  action: string
  /** Списка нет (или пуст) — поля размера в панели нет. */
  pageSizes?: readonly number[]
  fields: readonly SettingsField<V>[]
  /** Открытые возможности ИСТОЧНИКА (серверные данные). Без него — все открыты. */
  gates?: Record<FeatureGate, boolean>
  /** Идентификатор формы в механизме: уникален на страницу. */
  id?: string
}

/** Что делать со значением поля панели при записи в хранилище. */
interface Meta {
  kind: 'select' | 'toggle' | 'size'
  /** Ключ `extra` (без префикса адреса). */
  extra: string
  parse?: (raw: string) => ExtraValue
}

export interface PaginatorPanel {
  /** Схема универсальной панели — данные, ничего про хранилище. */
  schema: DemoPanelSchema<DemoValues>
  /** Значения панели → патч хранилища. Отсутствующие ключи не трогаем. */
  toPatch(values: Readonly<Record<string, unknown>>): {
    extra: Record<string, ExtraValue>
    size?: number
  }
  /** Хранилище → значения панели (seed и живое зеркало). */
  toPanel(values: Readonly<Record<string, unknown>>, pageSize: number): DemoValues
}

const raw = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** Значение условия/опции в строковой форме адресного ключа. */
const flag = (v: string | boolean): string => (typeof v === 'boolean' ? (v ? 'true' : 'false') : v)

export function paginatorPanel<V extends Record<string, ExtraValue>>(
  input: PaginatorPanelInput<V>,
): PaginatorPanel {
  const pp = input.pageParam
  const sizeName = `${pp}.size`
  const fields: DemoFieldSpec<string>[] = []
  const labels = new Map<string, string>()
  const meta = new Map<string, Meta>()
  /** Значения select-поля (для инверсии `enabledBy`) и их подписи. */
  const optionValues = new Map<string, { values: readonly string[]; labelOf: (v: string) => string }>()

  if (input.pageSizes && input.pageSizes.length > 0) {
    const values = input.pageSizes.map(String)
    labels.set(sizeName, 'Размер страницы')
    optionValues.set(sizeName, { values, labelOf: (v) => v })
    meta.set(sizeName, { kind: 'size', extra: sizeName })
    fields.push(
      demoSelect({
        key: sizeName,
        label: 'Размер страницы',
        url: false,
        defaultValue: values[0]!,
        options: values.map((v) => ({ value: v, label: v })),
      }),
    )
  }

  for (const f of input.fields) {
    if (f.type === 'divider') {
      if (f.label) fields.push(demoDivider(f.label))
      continue
    }
    const name = `${pp}.${f.key}`
    labels.set(name, f.label)

    /** Возможности источника — статическое выключение с причиной. */
    const required: readonly FeatureGate[] =
      f.requires === undefined ? [] : Array.isArray(f.requires) ? f.requires : [f.requires]
    const missing = required.filter((gate) => !(input.gates?.[gate] ?? true))
    const gateReason =
      missing.length > 0
        ? `источник не поддерживает ${missing.map((gate) => GATE_LABEL[gate]).join(' и ')}`
        : undefined

    // enabledBy → «выключено при каждом другом значении» по закрытому списку.
    // Текст — о РАЗРЕШЁННОМ значении: helper обязан читаться как объяснение доступа.
    const links: ((values: DemoValues) => string | undefined)[] = []
    for (const cond of f.enabledBy ?? []) {
      const depName = `${pp}.${cond.field}`
      const dep = optionValues.get(depName)
      if (!dep) continue // связка к полю вне панели — правило не строится, поле свободно
      const allowed = new Set(
        cond.in !== undefined
          ? cond.in.map(flag)
          : cond.equals !== undefined
            ? [flag(cond.equals)]
            : [],
      )
      const allowedText =
        cond.in !== undefined
          ? cond.in.map((v) => `«${dep.labelOf(flag(v))}»`).join(' или ')
          : cond.equals !== undefined
            ? `«${dep.labelOf(flag(cond.equals))}»`
            : 'условия'
      const depLabel = labels.get(depName) ?? cond.field
      links.push((values) => {
        const v = values[depName]
        const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : raw(v)
        if (s === '' || allowed.has(s)) return undefined
        return cond.reason ?? `доступно при «${depLabel}» = ${allowedText}`
      })
    }

    const disabledWhen =
      gateReason !== undefined || links.length > 0
        ? (values: DemoValues): string | undefined => {
            if (gateReason !== undefined) return gateReason
            for (const rule of links) {
              const why = rule(values)
              if (why !== undefined) return why
            }
            return undefined
          }
        : undefined

    if (f.type === 'toggle') {
      optionValues.set(name, {
        values: ['true', 'false'],
        labelOf: (v) => (v === 'true' ? 'включено' : 'выключено'),
      })
      meta.set(name, { kind: 'toggle', extra: f.key })
      fields.push(
        demoToggle({
          key: name,
          label: f.label,
          url: false,
          defaultValue: false,
          ...(f.jsOnly === true ? { jsOnly: true } : {}),
          ...(disabledWhen ? { disabledWhen } : {}),
        }),
      )
    } else {
      optionValues.set(name, {
        values: f.options.map(([value]) => value),
        labelOf: (v) => f.options.find(([value]) => value === v)?.[1] ?? v,
      })
      meta.set(name, { kind: 'select', extra: f.key, ...(f.parse ? { parse: f.parse } : {}) })
      fields.push(
        demoSelect({
          key: name,
          label: f.label,
          url: false,
          defaultValue: f.options[0]?.[0] ?? '',
          options: f.options.map(([value, label]) => ({ value, label })),
          ...(f.jsOnly === true ? { jsOnly: true } : {}),
          ...(disabledWhen ? { disabledWhen } : {}),
        }),
      )
    }
  }

  /** Хранилище → значения панели. Доменные значения, не строки разметки. */
  const toPanel = (values: Readonly<Record<string, unknown>>, pageSize: number): DemoValues => {
    const out: DemoValues = {}
    for (const [name, m] of meta) {
      if (m.kind === 'size') {
        out[name] = String(pageSize)
        continue
      }
      const v = values[m.extra]
      out[name] = m.kind === 'toggle' ? v === true || v === 'true' : raw(v)
    }
    return out
  }

  const toPatch = (
    values: Readonly<Record<string, unknown>>,
  ): { extra: Record<string, ExtraValue>; size?: number } => {
    const extra: Record<string, ExtraValue> = {}
    let size: number | undefined
    for (const [name, m] of meta) {
      if (!(name in values)) continue
      if (m.kind === 'size') {
        const n = Number(raw(values[name]))
        if (Number.isFinite(n) && n > 0) size = n
        continue
      }
      if (m.kind === 'toggle') {
        extra[m.extra] = values[name] === true
        continue
      }
      const s = raw(values[name])
      if (s === '') continue // значение не выбрано — ключ хранилища не трогаем
      extra[m.extra] = m.parse ? m.parse(s) : s
    }
    return size === undefined ? { extra } : { extra, size }
  }

  return {
    schema: {
      id: input.id ?? `demo-panel:${pp}`,
      action: input.action,
      fields,
    },
    toPatch,
    toPanel,
  }
}
