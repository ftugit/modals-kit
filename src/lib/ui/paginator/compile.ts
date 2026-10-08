// Компилятор демо-панели: `SettingsField[]` → описание формы + всё, чем shell
// размечает доступность, seed и патч (этап 6, §6.4/§6.5 `lib/links/panel`).
//
// Принцип тот же, что у компилятора фильтров: панель — ДАННЫЕ, а решение о
// выключении считает общий слой. Отличия домена:
//   • имена полей — канонические ключи адреса (`page.cols`, `gallery.size`);
//   • `page.size` — обычное поле (select), не специальный пропс: значение его
//     уходит не в extra, а в `setPageSize` — это решает маппер патча;
//   • `enabledBy` (данные) инвертируется в правила связок ядра `lib/links`:
//     «доступно при X=a» == «выключено при X=b, X=c, …» по ЗАКРЫТОМУ списку
//     значений X. Значение поля панели всегда одно из объявленных (дефолты
//     extra гарантированы), пустое поле — «не выбрано», правило не горит;
//   • `requires` гасит поле СТАТИЧЕСКИ: возможности источника — серверные
//     данные, они известны на SSR и не меняются, пока источник не сменили.
import type { ExtraValue, FeatureGate } from '$lib/paginate'
import { defineForm, field, policyWith, type FieldDraft, type FormDescription } from '$lib/form'
import type { LinkRule } from '$lib/links/links'
import type { SettingsField } from './types'

/** Подписи возможностей для причины «источник не поддерживает …». */
export const GATE_LABEL: Record<FeatureGate, string> = {
  nativeSearch: 'родной поиск',
  libSearch: 'lib/search',
  filters: 'фильтры',
  totals: 'число страниц',
  dictionary: 'словарь опечаток',
}

export interface DemoPanelInput<V extends Record<string, ExtraValue>> {
  /** Префикс ключей пагинатора в адресе (`page`, `gallery`). */
  pageParam: string
  /** Списка нет (или пуст) — поля размера в панели нет (как старый `{#if pageSizes}`). */
  pageSizes?: readonly number[]
  fields: readonly SettingsField<V>[]
  /** Открытые возможности ИСТОЧНИКА (серверные данные). Без него — все открыты. */
  gates?: Record<FeatureGate, boolean>
  /** Идентификатор формы в механизме: уникален на страницу, префикс — из имён. */
  id?: string
}

export interface DemoPanelPatch {
  extra: Record<string, ExtraValue>
  pageSize?: number
}

export interface DemoPanelSchema {
  definition: FormDescription
  /** Порядок вывода: группы за divider'ами; items — полные имена полей. */
  groups: readonly { label: string | undefined; items: readonly string[] }[]
  /** Правила живого слоя из `enabledBy` (инверсия); их потребляет `computeLinks`. */
  links: readonly LinkRule[]
  /** Подпись поля по его идентичности — для составителя текстов. */
  label(name: string): string
  /** Выключено возможностями источника: имя → причина (статика, компилируется). */
  gated: ReadonlyMap<string, string>
  /** Поля, требующие JS: гасятся до гидратации (решение shell — оно не данные). */
  jsOnly: ReadonlySet<string>
  /** Имя поля размера страницы. */
  sizeName: string
  /** Чем рисуется поле: селект / переключатель / размер. */
  kinds: ReadonlyMap<string, 'select' | 'toggle' | 'size'>
  /** Зеркало формы → патч хранилища. Отсутствующие ключи не трогаем (§6.4). */
  toPatch(values: Readonly<Record<string, unknown>>): DemoPanelPatch
  /**
   * Значения extra → seed зеркала формы. ДОМЕННЫЕ значения, не строки
   * разметки: seed механизм кладёт в state как есть (`bind.svelte.ts`).
   * Неотмеченный toggle — `false`, снятый select — пустая строка.
   */
  toSeed(values: Readonly<Record<string, ExtraValue | undefined>>, pageSize: number): Record<string, string | boolean>
}

// Имена полей панели — КЛЮЧИ ХРАНИЛИЩА И АДРЕСА (`page.topTrigger`): camelCase
// задан источником extra и адресом, переалфавитить его — значит разойтись с
// no-JS GET. Языковой политики пагинатор не имеет, так что шаблон сегментов
// расширяется здесь, а не в ядре (для фильтров camelCase-сегментов не нашлось).
const DEMO_PANEL_POLICY = policyWith({ names: { pattern: /^[a-z][a-zA-Z0-9_]{0,31}$/ } })

const raw = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** Значение условия/опции в строковой форме адресного ключа. */
const flag = (v: string | boolean): string => (typeof v === 'boolean' ? (v ? 'true' : 'false') : v)

export function compileDemoPanelSchema<V extends Record<string, ExtraValue>>(
  input: DemoPanelInput<V>,
): DemoPanelSchema {
  const pp = input.pageParam
  const sizeName = `${pp}.size`
  const drafts: Record<string, FieldDraft<never>> = Object.create(null)
  const labels = new Map<string, string>()
  const groups: { label: string | undefined; items: string[] }[] = [{ label: undefined, items: [] }]
  const links: LinkRule[] = []
  const gated = new Map<string, string>()
  const jsOnly = new Set<string>()
  /** name → маппинг в патч: kind + ключ extra + маппер значения. */
  const meta = new Map<string, { extra: string; kind: 'select' | 'toggle' | 'size'; parse?: (raw: string) => ExtraValue }>()

  // Значения select-поля (для инверсии enabledBy) и их подписи.
  const optionValues = new Map<string, { values: readonly string[]; labelOf: (v: string) => string }>()

  if (input.pageSizes && input.pageSizes.length > 0) {
    drafts[sizeName] = field.select({
      label: 'Размер страницы',
      options: input.pageSizes.map((n) => ({ value: String(n), label: String(n) })),
    }) as FieldDraft<never>
    labels.set(sizeName, 'Размер страницы')
    meta.set(sizeName, { extra: sizeName, kind: 'size' })
    optionValues.set(
      sizeName,
      { values: input.pageSizes.map((n) => String(n)), labelOf: (v) => v },
    )
    groups[0].items.push(sizeName)
  }

  for (const f of input.fields) {
    if (f.type === 'divider') {
      groups.push({ label: f.label, items: [] })
      continue
    }
    const name = `${pp}.${f.key}`
    const group = groups[groups.length - 1]
    group.items.push(name)
    labels.set(name, f.label)
    if (f.jsOnly) jsOnly.add(name)
    const required: readonly FeatureGate[] =
      f.requires === undefined ? [] : Array.isArray(f.requires) ? f.requires : [f.requires]
    const missing = required.filter((gate) => !(input.gates?.[gate] ?? true))
    if (missing.length > 0)
      gated.set(name, `источник не поддерживает ${missing.map((gate) => GATE_LABEL[gate]).join(' и ')}`)

    if (f.type === 'toggle') {
      drafts[name] = field.checkbox({ label: f.label }) as FieldDraft<never>
      optionValues.set(name, { values: ['true', 'false'], labelOf: (v) => (v === 'true' ? 'включено' : 'выключено') })
      meta.set(name, { extra: f.key, kind: 'toggle' })
    } else {
      drafts[name] = field.select({
        label: f.label,
        options: f.options.map(([value, label]) => ({ value, label })),
      }) as FieldDraft<never>
      optionValues.set(name, {
        values: f.options.map(([value]) => value),
        labelOf: (v) => f.options.find(([value]) => value === v)?.[1] ?? v,
      })
      meta.set(name, { extra: f.key, kind: 'select', parse: f.parse })
    }

    // enabledBy → «выключено при каждом другом значении» по закрытому списку.
    for (const cond of f.enabledBy ?? []) {
      const depName = `${pp}.${cond.field}`
      const dep = optionValues.get(depName)
      if (!dep) continue // связка к полю вне панели — правило не строится, поле свободно
      const allowed = new Set(
        cond.in !== undefined ? cond.in.map(flag) : cond.equals !== undefined ? [flag(cond.equals)] : [],
      )
      // Текст — о РАЗРЕШЁННОМ значении (оно в условии), а не о каждом
      // запрещённом: helper обязан читаться как объяснение доступа.
      const allowedText =
        cond.in !== undefined
          ? cond.in.map((v) => `«${dep.labelOf(flag(v))}»`).join(' или ')
          : cond.equals !== undefined
            ? `«${dep.labelOf(flag(cond.equals))}»`
            : 'условия'
      for (const value of dep.values) {
        if (allowed.has(value)) continue
        links.push({
          id: `${name}#enabledBy:${cond.field}=${value}`,
          when: [{ field: depName, value }],
          effect: { kind: 'disable-field', field: name },
          reason: cond.reason ?? `доступно при «${labels.get(depName) ?? cond.field}» = ${allowedText}`,
        })
      }
    }
  }

  const definition: FormDescription = defineForm({
    id: input.id ?? `demo-panel:${pp}`,
    fields: drafts as Record<string, FieldDraft<unknown>>,
    policy: DEMO_PANEL_POLICY,
  })

  const toPatch = (values: Readonly<Record<string, unknown>>): DemoPanelPatch => {
    const extra: Record<string, ExtraValue> = {}
    let pageSize: number | undefined
    for (const [name, m] of meta) {
      if (!(name in values)) continue
      if (m.kind === 'size') {
        const n = Number(raw(values[name]))
        if (Number.isFinite(n) && n > 0) pageSize = n
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
    return pageSize === undefined ? { extra } : { extra, pageSize }
  }

  const toSeed = (values: Readonly<Partial<V>>, pageSize: number): Record<string, string | boolean> => {
    const seed: Record<string, string | boolean> = {}
    if (meta.has(sizeName)) seed[sizeName] = String(pageSize)
    for (const [name, m] of meta) {
      if (m.kind === 'size') continue
      const v = values[m.extra as keyof V]
      if (m.kind === 'toggle') seed[name] = v === true || v === 'true'
      else seed[name] = v === undefined || v === null ? '' : String(v)
    }
    return seed
  }

  const kinds = new Map<string, 'select' | 'toggle' | 'size'>()
  for (const [name, m] of meta) kinds.set(name, m.kind)

  return {
    definition,
    groups,
    links,
    kinds,
    label: (name) => labels.get(name) ?? name,
    gated,
    jsOnly,
    sizeName,
    toPatch,
    toSeed,
  }
}
