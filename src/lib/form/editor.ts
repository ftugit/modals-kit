// Изменение набора полей.
//
// Операция — ДАННЫЕ, а не функция обработчика: один и тот же `SchemaOp`
// применяется в памяти при перехвате и на сервере при нативной отправке.
// Второго кода-пути не существует.
import { defineForm, type FieldDescriptor, type FormDescription } from './describe'
import { stableStringify, type FormError } from './result'
import type { FieldPath, RowKey } from './types'

/** Операция изменения набора полей формы. */
export type SchemaOp =
  | { op: 'add-field'; field: FieldDescriptor }
  | { op: 'remove-field'; name: string }
  | { op: 'replace-field'; name: string; next: FieldDescriptor }
  | { op: 'patch-field'; name: string; part: Partial<FieldDescriptor> }
  | { op: 'reorder'; order: readonly string[] }
  | { op: 'add-row'; group: string; rowKey: RowKey }
  | { op: 'remove-row'; group: string; rowKey: RowKey }
  | { op: 'move-row'; group: string; rowKey: RowKey; dir: 'up' | 'down' }

/** Фабрики операций над схемой формы. */
export const editor = {
  add: (field: FieldDescriptor): SchemaOp => ({ op: 'add-field', field }),
  remove: (name: string): SchemaOp => ({ op: 'remove-field', name }),
  replace: (name: string, next: FieldDescriptor): SchemaOp => ({ op: 'replace-field', name, next }),
  patch: (name: string, part: Partial<FieldDescriptor>): SchemaOp => ({ op: 'patch-field', name, part }),
  reorder: (order: readonly string[]): SchemaOp => ({ op: 'reorder', order }),
  addRow: (group: string, rowKey: RowKey): SchemaOp => ({ op: 'add-row', group, rowKey }),
  removeRow: (group: string, rowKey: RowKey): SchemaOp => ({ op: 'remove-row', group, rowKey }),
  moveRow: (group: string, rowKey: RowKey, dir: 'up' | 'down'): SchemaOp =>
    ({ op: 'move-row', group, rowKey, dir }),
}

/** Ошибка применения операции изменения схемы. */
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

/** Снять пометку свежести: со второго круга поле обычное. */
export function ageFields(d: FormDescription): FormDescription {
  if (!d.fields.some((f) => f.fresh)) return d
  return applyOps(d, d.fields.filter((f) => f.fresh)
    .map((f) => editor.patch(f.name, { fresh: false })))
}

/** Ошибка несогласованности состояния с описанием формы. */
export class InvariantError extends Error {}

/** Инвариант согласованности. Проверяется ПОСЛЕ каждой операции. */
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

/** Состояние, перенесённое на новую ревизию формы. */
export interface Reconciled {
  values: Record<string, unknown>
  facts: FormError[]
  dirty: Record<FieldPath, boolean>
  touched: Record<FieldPath, boolean>
  incompatible: string[]
}

/** Судьба состояния при изменении набора: §«что со значениями и ошибками». */
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
