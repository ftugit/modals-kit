<script lang="ts">
  /**
   * Поле `field.fields`: места под поля, которые собирает пользователь. Компонент
   * приложения — тексты правил выбирает оно; виды и их подписи — из объявления формы.
   *
   * У места: название, вид, правила (мультиселект) и числа выбранных правил.
   * Видны заполненные места и одно пустое: набранное название открывает следующее.
   * Без JavaScript: убрать поле — стереть название; новое место приходит после отправки.
   */
  import { untrack } from 'svelte'
  import { fieldSetName, type FieldSetItem, type FormError } from '#lib/form/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import { Button, Label } from '#lib/components/ui/index.js'
  import { JS_ONLY_REASON, useJsOnly } from '#lib/hooks/js-only.svelte.js'
  import NumberField from './NumberField.svelte'
  import SelectField from './SelectField.svelte'
  import TextField from './TextField.svelte'

  let f: FieldView = $props()

  const RULE_LABEL: Record<string, string> = {
    required: 'Обязательное', minLength: 'Мин. длина', maxLength: 'Макс. длина',
    minValue: 'Мин. значение', maxValue: 'Макс. значение', integer: 'Целое число',
  }
  /** Правила вида, которые снять нельзя, — словами. */
  const LOCKED_LABEL: Record<string, string> = {
    email: 'проверка адреса почты', url: 'проверка ссылки', pattern: 'номер в формате +79991234567',
  }

  const jsOnly = useJsOnly()
  const kit = $derived(f.fieldSet)

  interface Row { slot: string; label: string; kind: string; rules: string[]; args: Record<string, string> }

  function toRow(x: FieldSetItem): Row {
    const locked = kit?.rulesFor(x.preset)?.locked ?? []
    const chosen = (x.rules ?? []).filter((r) => !locked.some((l) => l.rule === r.rule))
    return {
      slot: x.name, label: x.label, kind: x.preset, rules: chosen.map((r) => r.rule),
      args: Object.fromEntries(chosen.filter((r) => r.arg !== undefined).map((r) => [r.rule, String(r.arg)])),
    }
  }
  const blank = (taken: readonly Row[]): Row => {
    let n = 1
    while (taken.some((r) => r.slot === `s${n}`)) n++
    return { slot: `s${n}`, label: '', kind: kit?.kinds[0] ?? '', rules: [], args: {} }
  }
  const roomFor = (list: readonly Row[]) => kit?.max === undefined || list.length < kit.max

  // С чего стартует: набранное (ответ без JS) сильнее сохранённого набора.
  let rows = $state(untrack(() => {
    const list = ((Array.isArray(f.value) ? f.value : Array.isArray(f.defaultValue) ? f.defaultValue : []) as FieldSetItem[]).map(toRow)
    return roomFor(list) ? [...list, blank(list)] : list
  }))
  // Пустое место всегда одно в конце; стёртое название место не прячет — строка не пропадает под курсором.
  $effect(() => {
    if (rows.every((r) => r.label.trim()) && roomFor(rows)) rows.push(blank(rows))
  })

  /** Значение для состояния формы: источник истины при отправке — разметка. */
  const report = () => f.onInput(rows.filter((r) => r.label.trim()).map((r) => ({
    name: r.slot, preset: r.kind, label: r.label.trim(), input: kit?.inputOf(r.kind) ?? 'text',
    rules: r.rules.map((rule) => (r.args[rule] ? { rule, arg: Number(r.args[rule]) } : { rule })),
  })))

  function remove(slot: string) {
    rows = rows.filter((r) => r.slot !== slot)
    if (!rows.some((r) => !r.label.trim()) && roomFor(rows)) rows.push(blank(rows))
    report()
  }

  const errorsAt = (path: string) => f.errors.filter((e) => e.path === path)
  const own = $derived(errorsAt(f.name))

  /** Вид вложенного контрола: тот же контракт, что у поля формы, — рисуют обычные компоненты. */
  function sub(row: Row, part: string, input: string, label: string, value: unknown,
               set: (raw: unknown) => void, extra: Partial<FieldView> = {}): FieldView {
    const name = fieldSetName(f.name, row.slot, part)
    const id = `${f.attrs['id']}-${name.slice(f.name.length + 1).replace(/\./g, '-')}`
    const errors: FormError[] = errorsAt(name)
    const errorId = `${id}-error`
    return {
      name, input, kind: input === 'multiselect' ? 'multiselect' : input === 'select' ? 'select' : 'text',
      attrs: {
        name, id,
        ...(input === 'select' || input === 'multiselect' ? {} : { value: value ?? '' }),
        ...(errors.length ? { 'aria-invalid': true, 'aria-errormessage': errorId, 'aria-describedby': errorId } : {}),
        ...(f.disabled ? { disabled: true } : {}),
      },
      skipped: [], label, errors, value, has: errors.length > 0,
      touched: false, dirty: false, fresh: false, checking: false,
      labelProps: () => ({ for: id }),
      helpProps: () => undefined,
      errorProps: () => (errors.length ? { id: errorId, role: 'alert' as const } : undefined),
      noteProps: () => undefined,
      setTouched: () => f.setTouched(),
      onInput: (raw) => { set(raw); report() },
      ...extra,
    }
  }

  const kindOptions = $derived((kit?.kinds ?? []).map((k) => ({ value: k, label: kit?.labelOf(k) ?? k })))
  /** Правила на выбор — разрешённые виду; уже выбранное видно, чтобы его можно было снять. */
  const ruleOptions = (row: Row) => {
    const allowed = kit?.rulesFor(row.kind)?.extra ?? []
    return [...new Set([...allowed, ...row.rules])].map((r) => ({ value: r, label: RULE_LABEL[r] ?? r }))
  }
  /** Число у правила — если у правила в схеме есть пределы. */
  const withArg = (row: Row) => row.rules.filter((r) => kit?.rulesFor(row.kind)?.limits[r])
  const lockedText = (row: Row) =>
    (kit?.rulesFor(row.kind)?.locked ?? []).map((r) => LOCKED_LABEL[r.rule] ?? r.rule).join(', ')
</script>

<!-- data-field — ручка тестов: имя поля формы -->
<div class="space-y-3" data-field={f.name} role="group" aria-labelledby="{f.attrs['id']}-label">
  <div>
    <Label id="{f.attrs['id']}-label">{f.label}</Label>
    {#if f.help}<p class="text-xs text-muted-foreground">{f.help}</p>{/if}
  </div>
  {#each own as e (e.id)}<p class="text-xs font-medium text-destructive" role="alert">{e.message}</p>{/each}
  {#each rows as row, i (row.slot)}
    {@const lock = lockedText(row)}
    <div data-slot={row.slot} class="space-y-3 rounded-lg border border-border p-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium">Поле {i + 1}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-testid="remove-{row.slot}"
          disabled={jsOnly() || !row.label.trim()}
          title={jsOnly() ? JS_ONLY_REASON : undefined}
          onclick={() => remove(row.slot)}
        >
          Удалить
        </Button>
      </div>
      {#each errorsAt(`${f.name}.${row.slot}`) as e (e.id)}
        <p class="text-xs font-medium text-destructive" role="alert">{e.message}</p>
      {/each}
      <div class="grid gap-3 sm:grid-cols-2">
        <TextField {...sub(row, 'label', 'text', 'Название поля', row.label, (raw) => (row.label = String(raw)),
                           { placeholder: 'например, «Ссылка»' })} />
        <SelectField {...sub(row, 'kind', 'select', 'Вид', row.kind, (raw) => (row.kind = String(raw)),
                             { options: kindOptions })} />
      </div>
      <SelectField {...sub(row, 'rules', 'multiselect', 'Правила', row.rules,
                           (raw) => (row.rules = (Array.isArray(raw) ? raw : []).map(String)),
                           { options: ruleOptions(row) })} />
      {#if lock}<p class="text-xs text-muted-foreground">Всегда: {lock}</p>{/if}
      {#if withArg(row).length}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each withArg(row) as r (r)}
            {@const def = kit?.rulesFor(row.kind)?.limits[r]?.default}
            <NumberField {...sub(row, r, 'number', RULE_LABEL[r] ?? r, row.args[r] ?? '',
                                 (raw) => (row.args[r] = String(raw ?? '')),
                                 def !== undefined ? { placeholder: String(def) } : {})} />
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
