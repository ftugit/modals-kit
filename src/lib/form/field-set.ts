// Тип значения `fields`: поля, которые собирает пользователь, — одно поле формы.
//
// Значение — список `FieldSetItem`. В разметке у каждого места свои записи:
//
//     props.s1.label        название поля (место без названия не считается)
//     props.s1.kind         ключ вида из каталога
//     props.s1.rules        выбранные правила (повторяется)
//     props.s1.max_length   значение правила: имя правила в snake_case
//
// Места (`s1`) — сегменты имени, порядок — порядок первого появления в форме.
// Разбор приводит список к пределам каталога (`kinds`, `rules`, `max` у `field.fields`):
// значение вне пределов заменяется, правило по умолчанию добавляется, правило вида
// снять нельзя. Каталог лежит в дескрипторе (`fieldSet`), его кладёт сахар.
import type { DecodeIssue, FieldType } from './field-types'
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

/** Встроенный тип набора полей от пользователя: `field.fields({ max, rules, kinds })`. */
export const fieldSetType: FieldType<readonly FieldSetItem[]> = {
  kind: 'fields', inputs: ['fields'], multiple: false, nested: true, empty: [],
  decode(_entries, ctx) {
    const kit = ctx.field?.fieldSet as FieldKit | undefined
    if (!kit || !ctx.form) return { ok: false, code: 'type.fields' }
    const head = `${ctx.path}.`
    const slots: string[] = []
    const shape: string[] = []
    for (const key of new Set(ctx.form.keys())) {
      if (!key.startsWith(head)) continue
      const [slot = '', part, ...rest] = key.slice(head.length).split('.')
      if (!slots.includes(slot)) slots.push(slot)
      // лишний уровень или повтор одиночной записи — ошибка клиента, а не «взять первое»
      if ((!part || rest.length || (part !== 'rules' && ctx.form.getAll(key).length > 1)) && !shape.includes(slot)) shape.push(slot)
    }
    const one = (slot: string, part: string) => text(ctx.form!.getAll(fieldSetName(ctx.path, slot, part))[0])
    const list: KitField[] = []
    for (const slot of slots) {
      const label = one(slot, 'label').trim()
      if (!label) continue
      const rules = ctx.form.getAll(fieldSetName(ctx.path, slot, 'rules')).map((r) => {
        const rule = text(r)
        const raw = one(slot, rule).trim()
        const n = Number(raw)
        // нечисло уходит каталогу как есть: он назовёт ошибку у своего правила
        return raw === '' ? { rule } : { rule, arg: Number.isFinite(n) ? n : raw }
      })
      list.push({ name: slot, kind: one(slot, 'kind'), label, rules })
    }
    const issues: DecodeIssue[] = shape.map((slot) => ({ code: 'kit.field-shape', at: slot }))
    const r = kit.compile(list)
    if (r.ok && !issues.length) return { ok: true, value: r.specs }
    if (!r.ok) for (const d of r.defects) {
      const at = issueAt(d.field, d)
      issues.push({ code: d.code, ...(at ? { at } : {}), params: { ...d.params, ...(d.rule ? { rule: d.rule } : {}) } })
    }
    const [first, ...more] = issues
    // набранное возвращается в разметку как есть: правило вида внутри не нужно, место знает вид
    const value = list.map((x): FieldSetItem => ({
      name: x.name, preset: x.kind, label: x.label, input: kit.inputOf(x.kind) ?? 'text', rules: x.rules ?? [],
    }))
    return { ok: false, ...first!, value, ...(more.length ? { more } : {}) }
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
    withoutJs: 'места под поля отрисованы сервером; поле убирается стиранием названия',
    lost: 'список правил меняется сразу при смене вида — без скрипта после отправки',
  },
}
