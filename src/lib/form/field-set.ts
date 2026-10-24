// Тип значения `fields`: поля, которые собирает пользователь, — одно поле формы.
//
// Значение — список `FieldSetItem`. В разметке у каждого места свои записи:
//
//     props.s1.label        название поля (место без названия не считается)
//     props.s1.kind         ключ вида из каталога
//     props.s1.rules        выбранные правила (повторяется)
//     props.s1.max_length   значение правила: имя правила в snake_case
//
// Места (`s1`, у новых — случайный ключ `fxxxxxx`) — сегменты имени, порядок — порядок
// первого появления в форме. Места рисует приложение (`fieldSet` в `#lib/form/svelte`).
// Разбор приводит список к пределам каталога (`kinds`, `rules`, `max` у `field.fields`):
// значение вне пределов заменяется, правило по умолчанию добавляется, правило вида
// снять нельзя. Каталог лежит в дескрипторе (`fieldSet`), его кладёт сахар.
import type { FormDescription } from './describe'
import type { DecodeIssue, EntrySource, FieldType } from './field-types'
import type { FieldKit, FieldSetItem, KitDefect, KitField } from './kit'

/** Часть имени для значения правила: `maxLength` → `max_length`. */
export const ruleArgPart = (rule: string) => rule.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/**
 * Имя записи места: `fieldSetName('props', 's1', 'label')` → `props.s1.label`.
 * @param name Имя поля формы.
 * @param slot Сегмент места.
 * @param part `label`, `kind`, `rules` или имя правила (для его значения).
 */
export const fieldSetName = (name: string, slot: string, part: string) =>
  `${name}.${slot}.${part === 'label' || part === 'kind' || part === 'rules' ? part : ruleArgPart(part)}`

const text = (x: unknown) => (typeof x === 'string' ? x : '')

/** Где в разметке показать дефект каталога. */
function issueAt(slot: string | undefined, d: KitDefect): string | undefined {
  if (!slot) return undefined
  switch (d.code) {
    case 'kit.unknown-kind': case 'kit.field-shape': return `${slot}.kind`
    case 'kit.rule-not-allowed': case 'kit.rule-duplicate': return `${slot}.rules`
    case 'kit.arg-type': case 'kit.arg-missing': return d.rule ? `${slot}.${ruleArgPart(d.rule)}` : slot
    default: return slot
  }
}

/** Места набора, как их несёт форма: по порядку появления; `shape` — места с лишним уровнем или повтором. */
function readSlots(form: EntrySource, name: string) {
  const head = `${name}.`
  const slots: string[] = []
  const shape: string[] = []
  for (const key of new Set(form.keys())) {
    if (!key.startsWith(head)) continue
    const [slot = '', part, ...rest] = key.slice(head.length).split('.')
    if (!slots.includes(slot)) slots.push(slot)
    // лишний уровень или повтор одиночной записи — ошибка клиента, а не «взять первое»
    if ((!part || rest.length || (part !== 'rules' && form.getAll(key).length > 1)) && !shape.includes(slot)) shape.push(slot)
  }
  return { slots, shape }
}

/** Описание места из записей: название как есть, правила со значениями (нечисло — строкой). */
function readSlot(form: EntrySource, name: string, slot: string): KitField {
  const one = (part: string) => text(form.getAll(fieldSetName(name, slot, part))[0])
  const rules = form.getAll(fieldSetName(name, slot, 'rules')).map((r) => {
    const rule = text(r)
    const raw = one(rule).trim()
    const n = Number(raw)
    // нечисло уходит каталогу как есть: он назовёт ошибку у своего правила
    return raw === '' ? { rule } : { rule, arg: Number.isFinite(n) ? n : raw }
  })
  // Правила возвращаются как есть: без скрипта список правил показывает ВСЕ
  // правила схемы, и правило не своего вида остаётся в набранном. Отбраковка —
  // дело схемы (`compile`): лишнее отклоняется ошибкой у «Правил», а не
  // молчаливым сбросом.
  return { name: slot, kind: one('kind'), label: one('label').trim(), rules }
}

const asItem = (kit: FieldKit, x: KitField): FieldSetItem => ({
  name: x.name, preset: x.kind, label: x.label, input: kit.inputOf(x.kind) ?? 'text', rules: x.rules ?? [],
})

/** Намерения кнопок набора: «+ поле» (`fields-add:имя`) и «Удалить» (`fields-remove:имя.ключ`). */
export const FIELD_SET_ADD = 'fields-add'
/** Служебная команда «удалить строку набора полей» в значении поля `fields`. */
export const FIELD_SET_REMOVE = 'fields-remove'

/**
 * Новый ключ места: случайный, а не «следующий номер» — удалённое поле не отдаёт свой
 * ключ новому, и старые значения под этим ключом не приписываются чужому полю.
 * @param taken Занятые ключи набора.
 */
export function fieldSetKey(taken: readonly string[] = []): string {
  const ABC = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (;;) {
    const key = `f${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ABC[b % ABC.length]).join('')}`
    if (!taken.includes(key)) return key
  }
}

/** Пустое место первого вида каталога. */
export function blankFieldSetItem(kit: FieldKit, taken: readonly string[]): FieldSetItem {
  const preset = kit.kinds[0] ?? ''
  return { name: fieldSetKey(taken), preset, label: '', input: kit.inputOf(preset) ?? 'text', rules: [] }
}

/** Место в разметке: правила — выбранные (без правил вида), их числа — строками, как в поле ввода. */
export interface FieldSetDraft {
  key: string
  preset: string
  label: string
  rules: string[]
  args: Record<string, string>
}

/** Место из поля набора — для разметки. */
export function fieldSetDraft(kit: FieldKit, x: FieldSetItem): FieldSetDraft {
  const locked = kit.rulesFor(x.preset)?.locked ?? []
  const chosen = (x.rules ?? []).filter((r) => !locked.some((l) => l.rule === r.rule))
  return {
    key: x.name, preset: x.preset, label: x.label, rules: chosen.map((r) => r.rule),
    args: Object.fromEntries(chosen.filter((r) => r.arg !== undefined).map((r) => [r.rule, String(r.arg)])),
  }
}

/** Поля набора из мест: место без названия не поле. Пределы применит разбор на сервере. */
export const fieldSetItems = (kit: FieldKit, drafts: readonly FieldSetDraft[]): FieldSetItem[] =>
  drafts.filter((d) => d.label.trim()).map((d) => ({
    name: d.key, preset: d.preset, label: d.label.trim(), input: kit.inputOf(d.preset) ?? 'text',
    rules: d.rules.map((rule) => (d.args[rule] ? { rule, arg: Number(d.args[rule]) } : { rule })),
  }))

/**
 * Правила места: `choices` — на выбор (разрешённые виду и уже выбранные, чтобы выбранное
 * можно было снять), `withArgs` — выбранные, у которых в схеме есть пределы числа.
 */
export function fieldSetRules(kit: FieldKit, d: FieldSetDraft) {
  const r = kit.rulesFor(d.preset)
  return {
    locked: r?.locked ?? [],
    choices: [...new Set([...(r?.extra ?? []), ...d.rules])],
    withArgs: d.rules.filter((x) => r?.limits[x]).map((x) => ({ rule: x, default: r!.limits[x]!.default })),
  }
}

/**
 * Кнопка набора, нажатая без JavaScript: форма ушла с намерением «+ поле» или «Удалить».
 * Ничего не сохраняется — возвращаются места как есть (и пустые) плюс новое или без удалённого.
 * @param form Записи формы.
 * @param d Описание формы.
 * @param intent Намерение из конверта.
 * @returns Имя поля и места для показа или `undefined`, если намерение не кнопки набора.
 */
export function fieldSetOp(form: EntrySource, d: FormDescription, intent: string):
  { name: string; items: FieldSetItem[] } | undefined {
  const { action, arg = '' } = d.policy.intent.parse(intent)
  if (action !== FIELD_SET_ADD && action !== FIELD_SET_REMOVE) return undefined
  const dot = arg.indexOf('.')
  const name = action === FIELD_SET_ADD ? arg : arg.slice(0, dot)
  const kit = d.byName[name]?.fieldSet
  if (!kit) return undefined
  let items = readSlots(form, name).slots.map((slot) => asItem(kit, readSlot(form, name, slot)))
  if (action === FIELD_SET_REMOVE) items = items.filter((x) => x.name !== arg.slice(dot + 1))
  else if (kit.max === undefined || items.length < kit.max) items = [...items, blankFieldSetItem(kit, items.map((x) => x.name))]
  return { name, items }
}

/** Встроенный тип набора полей от пользователя: `field.fields({ max, rules, kinds })`. */
export const fieldSetType: FieldType<readonly FieldSetItem[]> = {
  kind: 'fields', inputs: ['fields'], multiple: false, nested: true, empty: [],
  decode(_entries, ctx) {
    const kit = ctx.field?.fieldSet as FieldKit | undefined
    if (!kit || !ctx.form) return { ok: false, code: 'type.fields' }
    const { slots, shape } = readSlots(ctx.form, ctx.path)
    // место без названия не считается: так «пустое место» не становится полем
    const list = slots
      .map((slot) => readSlot(ctx.form!, ctx.path, slot))
      .filter((x) => x.label)
      .map((x) => {
        // правило вида в отправке отдельно не нужно: каталог добавит его сам.
        // Прислали дубль (он мог попасть в нативный select как выбранный) —
        // отбрасываем по имени, не дожидаясь отказа «не для вида».
        const locked = new Set((kit.rulesFor(x.kind)?.locked ?? []).map((l) => l.rule))
        return locked.size ? { ...x, rules: (x.rules ?? []).filter((r) => !locked.has(r.rule)) } : x
      })
    const issues: DecodeIssue[] = shape.map((slot) => ({ code: 'kit.field-shape', at: slot }))
    const r = kit.compile(list)
    if (r.ok && !issues.length) return { ok: true, value: r.specs }
    if (!r.ok) for (const d of r.defects) {
      const at = issueAt(d.field, d)
      issues.push({ code: d.code, ...(at ? { at } : {}), params: { ...d.params, ...(d.rule ? { rule: d.rule } : {}) } })
    }
    const [first, ...more] = issues
    // набранное возвращается в разметку как есть: правило вида внутри не нужно, место знает вид
    return { ok: false, ...first!, value: list.map((x) => asItem(kit, x)), ...(more.length ? { more } : {}) }
  },
  encode(value, name, out, ctx) {
    const kit = ctx?.field?.fieldSet as FieldKit | undefined
    for (const item of Array.isArray(value) ? value : []) {
      out.push([fieldSetName(name, item.name, 'label'), item.label])
      out.push([fieldSetName(name, item.name, 'kind'), item.preset])
      const locked = kit?.rulesFor(item.preset)?.locked ?? []
      for (const r of item.rules ?? []) {
        if (locked.some((l) => l.rule === r.rule)) continue
        out.push([fieldSetName(name, item.name, 'rules'), r.rule])
        if (typeof r.arg === 'number') out.push([fieldSetName(name, item.name, r.rule), String(r.arg)])
      }
    }
  },
  // «хотя бы одно поле» — единственное правило, которое имеет смысл для набора целиком
  constraints: { required: true },
  attrs: () => ({}),
  degradation: {
    withoutJs: '«+ поле» и «Удалить» — отправка формы с намерением: сервер возвращает места без сохранения',
    lost: 'без скрипта список правил показывает все правила схемы, лишнее отклонит проверка',
  },
}
