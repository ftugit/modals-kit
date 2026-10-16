<script lang="ts">
  /**
   * Конструктор набора полей. Ячейки постоянны (`s1…sN`), видны занятые и одна
   * пустая: набранное название открывает следующую — без кнопки «добавить».
   * Числа правил показываются, только когда правило выбрано: не отрисованное
   * поле не отправляется, и сервер его не видит.
   * Без JavaScript: убрать поле — стереть название; после «Сохранить» страница
   * придёт с новой пустой ячейкой.
   */
  import { untrack } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { bind, Form, formTask, type FieldView } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { jsonTransport } from '#lib/components/form/transport.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button } from '#lib/components/ui/index.js'
  import { JS_ONLY_REASON, useJsOnly } from '#lib/hooks/js-only.svelte.js'
  import Common from '#lib/components/form/Common.svelte'
  import Field from '#lib/components/form/Field.svelte'
  import {
    ARG_RULES, LOCKED_LABEL, argName, MAX_FIELDS, SLOTS, builderForm, builderValues, changeText, kit, slotName,
    type SavedSet,
  } from './kit'

  let { set, seed = null }: { set: SavedSet | null; seed?: Result | null } = $props()

  const jsOnly = useJsOnly()
  const form = bind(forms, builderForm, {
    action: '?/save',
    live: 'on-submit',
    transport: jsonTransport('/fields/save'),
    continuation: untrack(() => seed),
  })

  // Начальные значения — из сохранённого набора; набранное (и ответ без JS) сильнее.
  const start = untrack(() => builderValues(set))
  const val = (name: string) => (form.values[name] !== undefined ? form.values[name] : start[name])
  /** Вид поля со значением конструктора: и для разметки (`attrs.value`), и для контрола (`value`). */
  function view(name: string): FieldView {
    const v = form.f[name] as FieldView
    const value = val(name) ?? ''
    return { ...v, value, attrs: { ...v.attrs, value: Array.isArray(value) ? value.join(',') : String(value) } }
  }
  const part = (slot: string, p: string) => view(slotName(slot, p))
  const labelOf = (slot: string) => String(val(slotName(slot, 'label')) ?? '').trim()
  const nextFree = (taken: readonly string[]) => SLOTS.find((s) => !taken.includes(s) && !labelOf(s))

  // Открытые ячейки: занятые плюс одна пустая. Стёртое название ячейку не прячет
  // (иначе строка пропала бы под курсором) — прячет только «Удалить».
  let open = $state(untrack(() => {
    const used = SLOTS.filter((s) => labelOf(s))
    const free = nextFree(used)
    return free ? [...used, free] : used
  }))
  $effect(() => {
    if (open.length >= MAX_FIELDS || !open.every((s) => labelOf(s))) return
    const free = nextFree(open)
    if (free) open = [...open, free]
  })

  function remove(slot: string) {
    part(slot, 'label').onInput('')
    part(slot, 'kind').onInput('text')
    part(slot, 'rules').onInput([])
    for (const r of ARG_RULES) view(argName(slot, r)).onInput('')
    open = open.filter((s) => s !== slot)
    if (!open.some((s) => !labelOf(s))) {
      const free = nextFree(open)
      if (free) open = [...open, free]
    }
  }

  const picked = (slot: string): string[] => {
    const v = val(slotName(slot, 'rules'))
    return (Array.isArray(v) ? v : v ? [v] : []).map(String)
  }
  const kindOf = (slot: string) => String(val(slotName(slot, 'kind')) || 'text')

  /** Правила на выбор — только разрешённые виду; уже выбранное видно, чтобы его можно было снять. */
  function rulesView(slot: string): FieldView {
    const v = part(slot, 'rules')
    const allowed = kit.rulesFor(kindOf(slot))?.extra ?? []
    const chosen = picked(slot)
    return { ...v, options: (v.options ?? []).filter((o) => allowed.includes(String(o.value)) || chosen.includes(String(o.value))) }
  }
  const lockedText = (slot: string) =>
    (kit.rulesFor(kindOf(slot))?.locked ?? []).map((r) => LOCKED_LABEL[r.rule] ?? r.rule).join(', ')

  // Успех: набор лёг в кэш — страница перечитывает данные, конструктор
  // пересобирается из сохранённого (с поправками `compile`), появляется запись.
  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    last = now
    if (now === 'success') void invalidateAll()
  })
</script>

<section class="space-y-3" aria-labelledby="fields-step-builder">
  <div>
    <h2 id="fields-step-builder" class="text-xl font-semibold">1. Набор полей</h2>
    <p class="text-sm text-muted-foreground">
      До {MAX_FIELDS} полей. Поле без названия не сохраняется. Пределы правил задаёт набор:
      значение за пределом заменяется при сохранении.
    </p>
  </div>

  <Form id="fields-builder" {form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
    <Common errors={form.common} title="Набор не сохранён" />
    {#each open as slot, i (slot)}
      {@const lock = lockedText(slot)}
      <div data-slot={slot} class="space-y-3 rounded-lg border border-border p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">Поле {i + 1}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="remove-{slot}"
            disabled={jsOnly() || !labelOf(slot)}
            title={jsOnly() ? JS_ONLY_REASON : undefined}
            onclick={() => remove(slot)}
          >
            Удалить
          </Button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <Field of={part(slot, 'label')} />
          <Field of={part(slot, 'kind')} />
        </div>
        <Field of={rulesView(slot)} />
        {#if lock}<p class="text-xs text-muted-foreground">Всегда: {lock}</p>{/if}
        {#if ARG_RULES.some((r) => picked(slot).includes(r))}
          <div class="grid gap-3 sm:grid-cols-2">
            {#each ARG_RULES as r (r)}
              {#if picked(slot).includes(r)}<Field of={view(argName(slot, r))} />{/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    <Button type="submit" data-testid="save" task={formTask(form.state)}>Сохранить</Button>
  </Form>

  {#if set}
    <div class="rounded-lg border border-border p-3 text-sm" data-testid="saved-set">
      <p>Набор сохранён (версия {set.version}), полей: {set.specs.length}.</p>
      {#if set.changes.length}
        <p class="mt-2 font-medium">При сохранении изменено:</p>
        <ul class="list-disc pl-5" data-testid="changes">
          {#each set.changes as c, i (i)}<li>{changeText(c, set.specs)}</li>{/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
