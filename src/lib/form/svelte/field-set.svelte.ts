// Набор полей от пользователя (`field.fields`) — headless: данные и пропсы, без разметки.
//
//     const set = fieldSet(form, 'props', { labels: { label: 'Название', kind: 'Вид', rules: 'Правила' } })
//     {#each set.rows as row (row.key)} <Field of={row.label} /> … <button {...set.removeProps(row)}> {/each}
//     <button {...set.addProps()}>+ поле</button>
//
// С JS кнопки меняют список мест локально (`type="button"`), без JS — уходят
// обычной отправкой с намерением (`fields-add`, `fields-remove`).
import { onMount, untrack } from 'svelte'
import {
  blankFieldSetItem, fieldSetDraft, fieldSetItems, fieldSetName, fieldSetRules,
  FIELD_SET_ADD, FIELD_SET_REMOVE, type FieldSetDraft,
} from '../field-set'
import type { FieldSetItem } from '../kit'
import type { FormError } from '../result'
import type { SpecRule } from '../spec'
import type { BoundForm, FieldView, IntentProps } from './bind.svelte'

/** Тексты контролов места — их выбирает приложение. */
export interface FieldSetTexts {
  readonly labels: { readonly label: string; readonly kind: string; readonly rules: string }
  readonly rule?: (rule: string) => string
  readonly placeholder?: string
}

/** Одно место: вид поля для каждого контрола и то, что нужно разметке рядом. */
export interface FieldSetRow {
  readonly key: string
  readonly preset: string
  readonly label: FieldView
  readonly kind: FieldView
  readonly rules: FieldView
  readonly args: readonly FieldView[]
  readonly locked: readonly SpecRule[]
  readonly errors: readonly FormError[]
  readonly filled: boolean
}

/** Атрибуты кнопки набора полей: отправка с намерением или локальное действие без сети. */
export type FieldSetButtonProps =
  | (IntentProps & { type: 'submit' })
  | { type: 'button'; onclick: () => void; disabled?: boolean }

export function fieldSet(form: BoundForm, name: string, o: FieldSetTexts) {
  const of = () => form.f[name] as FieldView
  const kit = untrack(of)?.fieldSet
  if (!kit) throw new Error(`[form] fieldSet: поле '${name}' объявлено не через field.fields`)
  const ruleText = o.rule ?? ((r: string) => r)
  let hydrated = $state(false)
  onMount(() => { hydrated = true })

  const toRow = (x: FieldSetItem) => fieldSetDraft(kit, x)
  const readItems = (): readonly FieldSetItem[] => {
    const f = of()
    const list = Array.isArray(f.value) ? f.value : Array.isArray(f.defaultValue) ? f.defaultValue : []
    return list as FieldSetItem[]
  }
  let rows = $state<FieldSetDraft[]>(untrack(() => readItems().map(toRow)))
  const full = () => kit.max !== undefined && rows.length >= kit.max
  const report = () => of().onInput(fieldSetItems(kit, rows))

  let wasPending = false
  $effect(() => {
    const pending = form.state.pending
    if (wasPending && !pending) rows = readItems().map(toRow)
    wasPending = pending
  })

  const errorsAt = (path: string) => of().errors.filter((e) => e.path === path)

  function sub(row: FieldSetDraft, part: string, input: string, label: string, value: unknown,
               set: (raw: unknown) => void, extra: Partial<FieldView> = {}): FieldView {
    const f = of()
    const subName = fieldSetName(name, row.key, part)
    const id = `${f.attrs['id']}-${subName.slice(name.length + 1).replace(/\./g, '-')}`
    const errors = errorsAt(subName)
    const errorId = `${id}-error`
    return {
      name: subName, input, kind: input === 'select' || input === 'multiselect' ? input : input === 'number' ? 'number' : 'text',
      attrs: {
        name: subName, id,
        ...(input === 'select' || input === 'multiselect' ? {} : { value: value ?? '' }),
        ...(errors.length ? { 'aria-invalid': true, 'aria-errormessage': errorId, 'aria-describedby': errorId } : {}),
        ...(f.disabled ? { disabled: true } : {}),
      },
      skipped: [], label, errors, value, has: errors.length > 0,
      touched: false, dirty: false, checking: false,
      labelProps: () => ({ for: id }),
      helpProps: () => undefined,
      errorProps: () => (errors.length ? { id: errorId, role: 'alert' as const } : undefined),
      noteProps: () => undefined,
      setTouched: () => f.setTouched(),
      onInput: (raw) => { set(raw); report() },
      ...extra,
    }
  }

  const kindOptions = kit.kinds.map((k) => ({ value: k, label: kit.labelOf(k) ?? k }))

  function view(row: FieldSetDraft): FieldSetRow {
    const r = fieldSetRules(kit!, row)
    const lockedNames = r.locked.map((l) => l.rule)
    const choices = hydrated ? r.choices : kit!.rules.filter((x) => !lockedNames.includes(x))
    return {
      key: row.key, preset: row.preset, locked: r.locked, filled: !!row.label.trim(),
      errors: errorsAt(`${name}.${row.key}`),
      label: sub(row, 'label', 'text', o.labels.label, row.label, (raw) => (row.label = String(raw ?? '')),
                 o.placeholder ? { placeholder: o.placeholder } : {}),
      kind: sub(row, 'kind', 'select', o.labels.kind, row.preset, (raw) => {
        const next = String(raw ?? '')
        if (next !== row.preset) { row.rules = []; row.args = {} }
        row.preset = next
      }, { options: kindOptions }),
      rules: sub(row, 'rules', 'multiselect', o.labels.rules, [...lockedNames, ...row.rules],
                 (raw) => { row.rules = (Array.isArray(raw) ? raw : []).map(String).filter((x) => !lockedNames.includes(x)) },
                 {
                   options: [
                     ...r.locked.map((l) => ({ value: l.rule, label: ruleText(l.rule), disabled: true })),
                     ...choices.map((x) => ({ value: x, label: ruleText(x) })),
                   ],
                 }),
      args: r.withArgs.map((a) => sub(row, a.rule, 'number', ruleText(a.rule), row.args[a.rule] ?? '',
        (raw) => (row.args[a.rule] = String(raw ?? '')), a.default !== undefined ? { placeholder: String(a.default) } : {})),
    }
  }

  function add(): void {
    if (full()) return
    rows.push(toRow(blankFieldSetItem(kit!, rows.map((r) => r.key))))
    report()
  }

  function remove(key: string): void {
    const idx = rows.findIndex((r) => r.key === key)
    if (idx < 0) return
    rows.splice(idx, 1)
    report()
  }

  function btnProps(intent: string, onclick: () => void, blocked = false): FieldSetButtonProps {
    if (hydrated) return { type: 'button', onclick, ...(blocked || form.state.pending ? { disabled: true } : {}) }
    const p = { ...form.intent(intent), type: 'submit' as const }
    return blocked ? { ...p, disabled: true } : p
  }

  return {
    get rows(): FieldSetRow[] { return rows.map(view) },
    get errors(): readonly FormError[] { return errorsAt(name) },
    get full(): boolean { return full() },
    add,
    remove,
    addProps: () => btnProps(`${FIELD_SET_ADD}:${name}`, add, full()),
    removeProps: (row: { key: string }) => btnProps(`${FIELD_SET_REMOVE}:${name}.${row.key}`, () => remove(row.key)),
  }
}

export type FieldSetHandle = ReturnType<typeof fieldSet>
