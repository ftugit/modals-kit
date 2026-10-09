// Изменение набора полей.
//
// Операция — ДАННЫЕ, а не функция обработчика: один и тот же `SchemaOp`
// применяется в памяти при перехвате и на сервере при нативной отправке.
// Второго кода-пути не существует.
import { defineForm, type FieldDescriptor, type FormDescription } from './describe'
import { stableStringify, type FormError } from './result'
import type { FieldPath, RowKey } from './types'

export type SchemaOp =
  | { op: 'add-field'; field: FieldDescriptor }
  | { op: 'remove-field'; name: string }
  | { op: 'replace-field'; name: string; next: FieldDescriptor }
  | { op: 'patch-field'; name: string; part: Partial<FieldDescriptor> }
  | { op: 'reorder'; order: readonly string[] }
  | { op: 'add-row'; group: string; rowKey: RowKey }
  | { op: 'remove-row'; group: string; rowKey: RowKey }
  | { op: 'move-row'; group: string; rowKey: RowKey; dir: 'up' | 'down' }

/**
 * Конструкторы операций над набором полей. Операция — данные:
 * один и тот же `SchemaOp` применяется в памяти и на сервере.
 */
export const editor = {
  /** Добавить поле. Станет `fresh`: обязательность в первом круге не навязывается. */
  add: (field: FieldDescriptor): SchemaOp => ({ op: 'add-field', field }),
  /** Убрать поле; составные пути убираются префиксом. */
  remove: (name: string): SchemaOp => ({ op: 'remove-field', name }),
  /** Заменить поле целиком: значение переживёт замену только при том же типе. */
  replace: (name: string, next: FieldDescriptor): SchemaOp => ({ op: 'replace-field', name, next }),
  /** Поправить метаданные поля, не трогая значение. */
  patch: (name: string, part: Partial<FieldDescriptor>): SchemaOp => ({ op: 'patch-field', name, part }),
  /** Задать порядок полей списком имён. */
  reorder: (order: readonly string[]): SchemaOp => ({ op: 'reorder', order }),
  /** Добавить строку повторяемой группы по стабильному ключу. */
  addRow: (group: string, rowKey: RowKey): SchemaOp => ({ op: 'add-row', group, rowKey }),
  /** Убрать строку группы: адресация по ключу, соседние строки не съезжают. */
  removeRow: (group: string, rowKey: RowKey): SchemaOp => ({ op: 'remove-row', group, rowKey }),
  /** Сдвинуть строку группы вверх или вниз. */
  moveRow: (group: string, rowKey: RowKey, dir: 'up' | 'down'): SchemaOp =>
    ({ op: 'move-row', group, rowKey, dir }),
}

export class SchemaOpError extends Error {
  constructor(message: string) { super(`[form] ${message}`); this.name = 'SchemaOpError' }
}

/** Ключи строк группы в порядке объявления. Индекс — производное. */
export function groupRows(fields: readonly FieldDescriptor[]): Record<string, RowKey[]> {
  const out: Record<string, RowKey[]> = {}
  for (const f of fields) {
    const m = /^([a-z][a-z0-9_]*)\.([^.]+)\./.exec(f.name)
    if (!m) continue
    const [, group, key] = m
    const list = (out[group!] ??= [])
    if (!list.includes(key!)) list.push(key!)
  }
  return out
}

function rowTemplate(fields: readonly FieldDescriptor[], group: string): FieldDescriptor[] {
  const first = groupRows(fields)[group]?.[0]
  if (!first) return []
  return fields.filter((f) => f.name.startsWith(`${group}.${first}.`))
}

/**
 * АТОМАРНОСТЬ: сначала целиком строится следующий набор, потом один пересчёт.
 * Иначе подписчики увидят промежуточное состояние, а мета-валидация
 * отработает на половинчатом наборе.
 */
/**
 * Применить пакет операций атомарно: сначала целиком строится следующий
 * набор, потом один пересчёт. Ревизия увеличивается.
 * @param d Текущее описание.
 * @param ops Пакет операций.
 * @returns Новое описание.
 * @throws {SchemaOpError} Операция невыполнима: дубль, нет группы.
 */
export function applyOps(d: FormDescription, ops: readonly SchemaOp[]): FormDescription {
  let fields = [...d.fields]

  for (const op of ops) {
    switch (op.op) {
      case 'add-field':
        if (fields.some((f) => f.name === op.field.name))
          throw new SchemaOpError(`поле '${op.field.name}' уже есть`)
        // поле, созданное в этом круге, помечается fresh: обязательность
        // в первом круге не навязывается
        fields.push({ ...op.field, fresh: true })
        break
      case 'remove-field':
        fields = fields.filter((f) => f.name !== op.name && !f.name.startsWith(`${op.name}.`))
        break
      case 'replace-field':
        fields = fields.map((f) => (f.name === op.name ? { ...op.next, name: op.name } : f))
        break
      case 'patch-field':
        // метаданные меняются, значения не трогаются
        fields = fields.map((f) => (f.name === op.name ? { ...f, ...op.part, name: f.name } : f))
        break
      case 'reorder': {
        const pos = new Map(op.order.map((n, i) => [n, i]))
        fields = [...fields].sort((a, b) => (pos.get(a.name) ?? a.order) - (pos.get(b.name) ?? b.order))
        break
      }
      case 'add-row': {
        if (groupRows(fields)[op.group]?.includes(op.rowKey))
          throw new SchemaOpError(`строка '${op.rowKey}' в группе '${op.group}' уже есть`)
        const template = rowTemplate(fields, op.group)
        if (!template.length) throw new SchemaOpError(`группа '${op.group}' не объявлена`)
        for (const t of template)
          fields.push({ ...t, name: t.name.replace(/\.[^.]+\./, `.${op.rowKey}.`), fresh: true })
        break
      }
      case 'remove-row':
        // адресация по СТАБИЛЬНОМУ ключу: соседние строки не съезжают
        fields = fields.filter((f) => !f.name.startsWith(`${op.group}.${op.rowKey}.`))
        break
      case 'move-row': {
        const keys = groupRows(fields)[op.group] ?? []
        const i = keys.indexOf(op.rowKey)
        const j = op.dir === 'up' ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= keys.length) break
        const order = [...keys]
        ;[order[i], order[j]] = [order[j]!, order[i]!]
        const rank = (f: FieldDescriptor) => {
          const m = new RegExp(`^${op.group}\\.([^.]+)\\.`).exec(f.name)
          return m ? order.indexOf(m[1]!) : -1
        }
        fields = [...fields].sort((a, b) => {
          const ra = rank(a), rb = rank(b)
          return ra < 0 || rb < 0 ? a.order - b.order : ra - rb
        })
        break
      }
    }
  }

  // один пересчёт на весь пакет: мета-валидация увидит целое описание
  const draft: Record<string, Omit<FieldDescriptor, 'name' | 'order'>> = {}
  fields.forEach((f) => {
    const { name: _n, order: _o, ...rest } = f
    draft[f.name] = rest
  })

  return defineForm({
    id: d.id,
    revision: d.revision + 1,
    fields: draft as never,
    actions: d.actions,
    messages: d.messages as Record<string, string>,
    cardinality: d.cardinality,
    invalidFrom: d.invalidFrom,
    registry: d.registry,
    policy: d.policy,
  })
}

/**
 * Снять пометку свежести: со второго круга поле обычное.
 * @param d Описание с `fresh`-полями.
 */
export function ageFields(d: FormDescription): FormDescription {
  if (!d.fields.some((f) => f.fresh)) return d
  return applyOps(d, d.fields.filter((f) => f.fresh)
    .map((f) => editor.patch(f.name, { fresh: false })))
}

export class InvariantError extends Error {}

/**
 * Инвариант согласованности: нет осиротевших ошибок и значений,
 * у свежих полей не висит обязательность.
 * @param d Описание.
 * @param s Состояние формы.
 * @throws {InvariantError} Рассогласование.
 */
export function assertConsistent(d: FormDescription, s: {
  facts: readonly FormError[]
  values: Readonly<Record<string, unknown>>
}): void {
  const names = new Set(d.fields.map((f) => f.name))
  for (const e of s.facts)
    if (e.path && !names.has(e.path)) throw new InvariantError(`осиротевшая ошибка: ${e.path}`)
  for (const path of Object.keys(s.values))
    if (!names.has(path)) throw new InvariantError(`осиротевшее значение: ${path}`)
  for (const f of d.fields)
    if (f.fresh && s.facts.some((e) => e.path === f.name && e.code === 'required'))
      throw new InvariantError(`обязательность у свежесозданного поля: ${f.name}`)
}

export interface Reconciled {
  values: Record<string, unknown>
  facts: FormError[]
  dirty: Record<FieldPath, boolean>
  touched: Record<FieldPath, boolean>
  incompatible: string[]
}

/**
 * Судьба состояния при изменении набора: значения и ошибки сохраняются
 * по именам, пока правила не менялись; несовместимая замена сбрасывает
 * значение и даёт общую ошибку.
 * @param next Новое описание.
 * @param prev Прежнее описание.
 * @param s Состояние на момент перехода.
 */
export function reconcile(next: FormDescription, prev: FormDescription, s: {
  values: Readonly<Record<string, unknown>>
  facts: readonly FormError[]
  dirty: Readonly<Record<string, boolean>>
  touched: Readonly<Record<string, boolean>>
}): Reconciled {
  const values: Record<string, unknown> = {}
  const dirty: Record<string, boolean> = {}
  const touched: Record<string, boolean> = {}
  const keep = new Set<string>()
  const incompatible: string[] = []

  for (const f of next.fields) {
    const before = prev.byName[f.name]
    const empty = () => {
      try { return next.registry.types.get(f.kind).empty } catch { return null }
    }
    if (!before || f.fresh) { values[f.name] = f.defaultValue ?? empty(); continue }
    if (before.kind !== f.kind) {
      // несовместимая замена: значение сбрасывается, ошибка уходит в общее место
      values[f.name] = f.defaultValue ?? empty()
      incompatible.push(f.name)
      continue
    }
    values[f.name] = s.values[f.name] ?? f.defaultValue ?? empty()
    if (s.dirty[f.name]) dirty[f.name] = true
    if (s.touched[f.name]) touched[f.name] = true
    // Ошибки сохраняются, только если правила поля не менялись. Сравниваем
    // ОГРАНИЧЕНИЯ, а не валидаторы: валидатор — функция, и её сериализация
    // одинакова у любых двух, то есть сравнение всегда давало бы «не менялись».
    const sameRules =
      stableStringify(prev.constraintsOf(f.name)) === stableStringify(next.constraintsOf(f.name))
    if (sameRules) keep.add(f.name)
  }

  const facts = s.facts.filter((e) => !e.path || keep.has(e.path))
  for (const name of incompatible)
    facts.push({
      id: `*:value.incompatible:${name}`, code: 'value.incompatible',
      params: { field: name }, origin: 'core',
    })
  return { values, facts, dirty, touched, incompatible }
}
