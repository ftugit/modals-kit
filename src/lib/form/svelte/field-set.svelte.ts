// Набор полей от пользователя (`field.fields`) — headless: данные и пропсы, без разметки.
//
// Форма это поле сама не рисует. Цикл по местам, кнопку «+ поле», обёртки и классы
// расставляет приложение; хук даёт места (`rows`) с готовыми видами контролов — их
// рисует обычный `Field` или свой компонент — и пропсы кнопок.
//
//     const set = fieldSet(form, 'props', { labels: { label: 'Название', kind: 'Вид', rules: 'Правила' } })
//     {#each set.rows as row (row.key)} <Field of={row.label} /> … <button {...set.removeProps(row)}> {/each}
//     <button {...set.addProps()}>+ поле</button>
//
// Без JavaScript кнопки — отправка формы с намерением (`fields-add`, `fields-remove`):
// сервер ничего не сохраняет и возвращает места с новым или без удалённого.
import { onMount, untrack } from 'svelte'
import {
  blankFieldSetItem, fieldSetDraft, fieldSetItems, fieldSetName, fieldSetRules, FIELD_SET_ADD, FIELD_SET_REMOVE,
  type FieldSetDraft,
} from '../field-set'
import type { FieldSetItem } from '../kit'
import type { FormError } from '../result'
import type { SpecRule } from '../spec'
import type { BoundForm, FieldView, IntentProps } from './bind.svelte'

/** Тексты контролов места — их выбирает приложение. */
export interface FieldSetTexts {
  /** Подписи названия, вида и списка правил. */
  readonly labels: { readonly label: string; readonly kind: string; readonly rules: string }
  /** Подпись правила в списке и у его числа; без неё — имя правила. */
  readonly rule?: (rule: string) => string
  /** Подсказка в пустом названии. */
  readonly placeholder?: string
}

/** Одно место: вид поля для каждого контрола и то, что нужно разметке рядом. */
export interface FieldSetRow {
  /** Ключ места — сегмент имени, он же имя поля в форме записи (`u_<key>`). */
  readonly key: string
  /** Выбранный вид из каталога. */
  readonly preset: string
  readonly label: FieldView
  readonly kind: FieldView
  readonly rules: FieldView
  /** Числа выбранных правил — у правил, для которых в схеме заданы пределы. */
  readonly args: readonly FieldView[]
  /** Правила вида: всегда есть у поля, снять нельзя. */
  readonly locked: readonly SpecRule[]
  /**
   * Служебное поле `rules_kind`: вид, для которого рисовали список правил.
   * Его значение — `preset` места; сервер сбрасывает выбор правил, когда
   * присланный вид с ним не совпадает (смена вида без скрипта).
   */
  readonly rulesKind: FieldView
  /** Ошибки места целиком (не отдельного контрола). */
  readonly errors: readonly FormError[]
  /** Название набрано: место станет полем при отправке. */
  readonly filled: boolean
}

/** Пропсы кнопки набора: отправка с намерением без JS, своё действие с JS. */
export type FieldSetButtonProps = IntentProps & { type: 'submit' | 'button'; onclick: (e: MouseEvent) => void }

/**
 * Места набора полей для разметки приложения.
 * @param form Связанная форма (`bind`).
 * @param name Имя поля `field.fields`.
 * @param o Тексты контролов.
 * @returns `rows`, `errors`, `full`, `addProps()`, `removeProps(row)`, `add()`, `remove(key)`.
 * @throws Поле не объявлено через `field.fields`.
 */
export function fieldSet(form: BoundForm, name: string, o: FieldSetTexts) {
  const of = () => form.f[name] as FieldView
  const kit = untrack(of)?.fieldSet
  if (!kit) throw new Error(`[form] fieldSet: поле '${name}' объявлено не через field.fields`)
  const ruleText = o.rule ?? ((r: string) => r)
  // После оживления кнопки — `type="button"`: Enter в поле нажимает первую кнопку отправки
  // формы, и ею не должна оказаться «Удалить» первого места. Без JS они остаются отправкой —
  // первой кнопкой формы приложение ставит свою (README, «Набор полей от пользователя»).
  let hydrated = $state(false)
  onMount(() => { hydrated = true })

  const toRow = (x: FieldSetItem) => fieldSetDraft(kit, x)
  // с чего стартует: набранное (ответ без JS) сильнее сохранённого
  let rows = $state<FieldSetDraft[]>(untrack(() => {
    const f = of()
    const list = Array.isArray(f.value) ? f.value : Array.isArray(f.defaultValue) ? f.defaultValue : []
    return (list as FieldSetItem[]).map(toRow)
  }))
  const full = () => kit.max !== undefined && rows.length >= kit.max

  /** Значение для состояния формы; при отправке источник истины — разметка. */
  const report = () => of().onInput(fieldSetItems(kit, rows))

  function add() {
    if (full()) return
    rows.push(toRow(blankFieldSetItem(kit!, rows.map((r) => r.key))))
    report()
  }
  function remove(key: string) {
    rows = rows.filter((r) => r.key !== key)
    report()
  }

  const errorsAt = (path: string) => of().errors.filter((e) => e.path === path)

  /** Вид контрола места: тот же контракт, что у поля формы. */
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
    // правило вида показываем ВНУТРИ списка правил выбранным и недосягаемым:
    // оно и так стоит у поля, отдельной отправки не требует (encode его пропускает)
    const lockedNames = r.locked.map((l) => l.rule)
    return {
      key: row.key, preset: row.preset, locked: r.locked, filled: !!row.label.trim(),
      errors: errorsAt(`${name}.${row.key}`),
      label: sub(row, 'label', 'text', o.labels.label, row.label, (raw) => (row.label = String(raw ?? '')),
                 o.placeholder ? { placeholder: o.placeholder } : {}),
      kind: sub(row, 'kind', 'select', o.labels.kind, row.preset, (raw) => {
        const next = String(raw ?? '')
        // сменили вид — выбранные правила обнуляются: они были про прежний вид
        if (next !== row.preset) { row.rules = []; row.args = {} }
        row.preset = next
      }, { options: kindOptions }),
      rules: sub(row, 'rules', 'multiselect', o.labels.rules, [...lockedNames, ...row.rules],
                 (raw) => {
                   // правило вида — только в картинке: в выбор и в отправку не попадает
                   row.rules = (Array.isArray(raw) ? raw : []).map(String).filter((x) => !lockedNames.includes(x))
                 },
                 {
                   options: [
                     ...r.locked.map((l) => ({ value: l.rule, label: ruleText(l.rule), disabled: true })),
                     ...r.choices.map((x) => ({ value: x, label: ruleText(x) })),
                   ],
                 }),
      rulesKind: sub(row, 'rules_kind', 'hidden', '', row.preset, () => {}),
      args: r.withArgs.map((a) => sub(row, a.rule, 'number', ruleText(a.rule), row.args[a.rule] ?? '',
        (raw) => (row.args[a.rule] = String(raw ?? '')), a.default !== undefined ? { placeholder: String(a.default) } : {})),
    }
  }

  const button = (intent: string, act: () => void): FieldSetButtonProps => ({
    ...form.intent(intent), type: hydrated ? 'button' : 'submit',
    onclick: (e) => { e.preventDefault(); act() },
  })

  return {
    /** Места в порядке набора. */
    get rows(): FieldSetRow[] { return rows.map(view) },
    /** Ошибки набора целиком: предел числа полей и т. п. */
    get errors(): readonly FormError[] { return errorsAt(name) },
    /** Предел числа полей достигнут: «+ поле» ничего не добавит. */
    get full(): boolean { return full() },
    /** Пропсы кнопки «+ поле»: где её поставить — решает разметка. */
    addProps(): FieldSetButtonProps {
      const p = button(`${FIELD_SET_ADD}:${name}`, add)
      return full() ? { ...p, disabled: true } : p
    },
    /** Пропсы кнопки «Удалить» у места. */
    removeProps(row: { key: string }): FieldSetButtonProps {
      return button(`${FIELD_SET_REMOVE}:${name}.${row.key}`, () => remove(row.key))
    },
    add, remove,
  }
}

export type FieldSetHandle = ReturnType<typeof fieldSet>
