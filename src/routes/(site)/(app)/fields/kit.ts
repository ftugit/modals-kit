// Изоморфная часть страницы `/fields`: каталог видов и схема валидаторов
// (`defineFieldKit`), форма конструктора и форма записи. Её импортируют и страница,
// и сервер — расхождение «браузер проверяет одно, сервер другое» исключено.
import {
  ageFields, appendFields, compileFieldSpecs, defineFieldKit, defineForm, field, v,
  type FieldSpec, type FormDescription, type KitChange, type KitField, type SpecRule,
} from '#lib/form/index.js'

/** Сколько полей можно собрать: предел поля-родителя. */
export const MAX_FIELDS = 8

/** Набор: виды, правила на выбор и пределы аргументов. Тексты — ниже, в приложении. */
export const kit = defineFieldKit({
  limits: { fields: MAX_FIELDS },
  rules: {
    required: {},
    integer: {},
    minLength: { min: 0, max: 2000 },
    maxLength: { min: 1, max: 2000, default: 200 },
    minValue: { min: -1_000_000, max: 1_000_000 },
    maxValue: { min: -1_000_000, max: 1_000_000 },
  },
  kinds: {
    text: { input: 'text', extra: ['required', 'minLength', 'maxLength'] },
    textarea: { input: 'textarea', extra: ['required', 'minLength', 'maxLength'], rules: { maxLength: { default: 1000 } } },
    email: { input: 'email', locked: ['email'], extra: ['required', 'maxLength'], rules: { maxLength: { max: 254 } } },
    url: { input: 'url', locked: ['url'], extra: ['required', 'maxLength'], rules: { maxLength: { default: 2000 } } },
    tel: { input: 'tel', locked: [{ rule: 'pattern', arg: 'e164' }], extra: ['required'] },
    number: { input: 'number', extra: ['required', 'minValue', 'maxValue', 'integer'] },
  },
})

export const KIND_LABEL: Record<string, string> = {
  text: 'Строка', textarea: 'Текст', email: 'Почта', url: 'Ссылка', tel: 'Телефон', number: 'Число',
}
export const RULE_LABEL: Record<string, string> = {
  required: 'Обязательное', minLength: 'Мин. длина', maxLength: 'Макс. длина',
  minValue: 'Мин. значение', maxValue: 'Макс. значение', integer: 'Целое число',
}
/** Правила вида, которые снять нельзя, — словами. */
export const LOCKED_LABEL: Record<string, string> = {
  email: 'проверка адреса почты', url: 'проверка ссылки', pattern: 'номер в формате +79991234567',
}
/** Правила со значением: у каждого своё числовое поле в строке конструктора. */
export const ARG_RULES = ['minLength', 'maxLength', 'minValue', 'maxValue'] as const
const ALL_RULES = ['required', ...ARG_RULES, 'integer'] as const

/** Ячейки конструктора `s1…sN`: ключ ячейки и есть имя поля пользователя. */
export const SLOTS = Array.from({ length: MAX_FIELDS }, (_, i) => `s${i + 1}`)
export const slotName = (slot: string, part: string) => `fields.${slot}.${part}`
/** Имя числа правила в ячейке: сегменты имён — строчные (`maxLength` → `max_length`). */
export const argName = (slot: string, rule: string) =>
  slotName(slot, rule.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))

/** Сохранённый набор: то, что лежит в кэше. */
export interface SavedSet {
  readonly version: number
  /** Описания после `compile` — их поднимает сервер формы записи. */
  readonly specs: readonly FieldSpec[]
  /** Что `compile` заменил при сохранении. */
  readonly changes: readonly KitChange[]
}

/**
 * Значения конструктора из сохранённого набора: с них страница начинает.
 * Не `defaultValue` описания: умолчание поля возвращается в разметку, когда
 * значение стёрто, а «Удалить» обязано стирать по-настоящему.
 */
export function builderValues(saved: SavedSet | null): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(SLOTS.map((s) => [slotName(s, 'kind'), 'text']))
  for (const spec of saved?.specs ?? []) {
    const slot = spec.name
    const kind = kit.kinds.find((k) => kit.inputOf(k) === spec.input) ?? 'text'
    const locked = kit.rulesFor(kind)?.locked ?? []
    const chosen = (spec.rules ?? []).filter((r) => !locked.some((l) => l.rule === r.rule && l.arg === r.arg))
    out[slotName(slot, 'label')] = spec.label
    out[slotName(slot, 'kind')] = kind
    out[slotName(slot, 'rules')] = chosen.map((r) => r.rule)
    for (const r of chosen) if ((ARG_RULES as readonly string[]).includes(r.rule)) out[argName(slot, r.rule)] = r.arg
  }
  return out
}

/**
 * Форма конструктора: на каждую ячейку — название, вид, правила (мультиселект) и
 * числа правил. Набор имён постоянный: ячеек ровно `MAX_FIELDS`, страница рисует
 * занятые и одну пустую. Неотрисованная ячейка не отправляется — и не мешает.
 */
export const builderForm: FormDescription = (() => {
  const fields: Record<string, ReturnType<typeof field.text>> = {}
  for (const slot of SLOTS) {
    fields[slotName(slot, 'label')] = field.text({
      label: 'Название поля', placeholder: 'например, «Ссылка»', validate: [v.maxLength(60)],
    })
    fields[slotName(slot, 'kind')] = field.select({
      label: 'Вид', options: kit.kinds.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k })),
    })
    fields[slotName(slot, 'rules')] = field.multiselect({
      label: 'Правила', options: ALL_RULES.map((r) => ({ value: r, label: RULE_LABEL[r] ?? r })),
    })
    for (const r of ARG_RULES) fields[argName(slot, r)] = field.number({ label: RULE_LABEL[r] })
  }
  return defineForm({
    id: 'fields-builder',
    revision: 1,
    cardinality: 'first',
    actions: [{ id: 'submit', label: 'Сохранить', validate: 'full' }],
    fields,
  })
})()

/** Ячейка занята, если у поля есть название: пустая ячейка пропускается. */
export const usedSlots = (values: Readonly<Record<string, unknown>>) =>
  SLOTS.filter((s) => String(values[slotName(s, 'label')] ?? '').trim() !== '')

/** Значения конструктора → описания для `kit.compile`. */
export function toKitFields(values: Readonly<Record<string, unknown>>): KitField[] {
  return usedSlots(values).map((slot) => {
    const picked = values[slotName(slot, 'rules')]
    const list = (Array.isArray(picked) ? picked : picked ? [picked] : []).map(String)
    const rules: SpecRule[] = list.map((rule) => {
      if (!(ARG_RULES as readonly string[]).includes(rule)) return { rule }
      const raw = values[argName(slot, rule)]
      return raw === undefined || raw === null || raw === '' ? { rule } : { rule, arg: raw as number }
    })
    return { name: slot, kind: String(values[slotName(slot, 'kind')] ?? 'text'), label: String(values[slotName(slot, 'label')]).trim(), rules }
  })
}

/* ── форма записи ─────────────────────────────────────────────────── */

/** Типы изображений, которые принимает запись. Сервер сверяет и содержимое. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const IMAGE_MAX_BYTES = 1024 * 1024

/** Постоянная часть записи: название и изображение. Поля пользователя — из набора. */
export const recordBase = defineForm({
  id: 'fields-record',
  revision: 1,
  cardinality: 'first',
  actions: [{ id: 'submit', label: 'Отправить', validate: 'full' }],
  fields: {
    title: field.text({ label: 'Название', validate: [v.required(), v.maxLength(120)] }),
    image: field.file({
      label: 'Изображение',
      help: 'PNG, JPEG, WebP или GIF, до 1 МБ',
      validate: [v.required(), v.accept([...IMAGE_TYPES]), v.maxSize(IMAGE_MAX_BYTES)],
    }),
  },
})

/**
 * Описание записи в браузере — то же, что поднимает сервер (`createAppSource`):
 * база плюс поля набора; сохранённые поля не «свежие», `required` действует сразу.
 */
export function recordForm(specs: readonly FieldSpec[]): FormDescription {
  if (!specs.length) return recordBase
  const compiled = compileFieldSpecs(specs, { registry: recordBase.registry, policy: recordBase.policy })
  if (!compiled.ok) throw new Error('[fields] сохранённый набор не компилируется')
  return ageFields(appendFields(recordBase, compiled.fields))
}

/** Пример записи: то, что показывается после отправки. */
export interface SavedRecord {
  /** Номер отправки: новая запись — новая форма (пересборка по ключу). */
  readonly n: number
  readonly title: string
  /** `data:image/…;base64,…` — тип по содержимому файла, а не по заявке браузера. */
  readonly image: string
  readonly entries: readonly { readonly label: string; readonly value: string }[]
}

/** Замена при сохранении — словами (тексты выбирает приложение). */
export function changeText(c: KitChange, specs: readonly FieldSpec[]): string {
  const label = specs.find((s) => s.name === c.field)?.label ?? c.field
  const rule = RULE_LABEL[c.rule] ?? c.rule
  if (c.code === 'clamped') return `«${label}», ${rule}: ${String(c.from)} → ${c.to} (предел)`
  if (c.code === 'defaulted') return `«${label}», ${rule}: значение не указано → ${c.to}`
  return `«${label}»: добавлено правило «${rule}» = ${c.to} (по умолчанию)`
}
