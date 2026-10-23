<script lang="ts">
  // Самодостаточный конструктор схемы полей (`field.fields`) поверх `#hooks/component-form`:
  // работает на любом маршруте и в модалке с JS и без JS (`+ поле` и `Удалить` без JS
  // мутируют черновик через inline-ответ `not-applied`, а `Enter` без JS всегда бьёт в
  // первую скрытую submit-кнопку сохранения).
  import { untrack } from 'svelte'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { fieldSet, Form, formTask } from '#lib/form/svelte/index.js'
  import { cn } from '../../utils'
  import Common from '../form/Common.svelte'
  import Field from '../form/Field.svelte'
  import { forms } from '../form/forms.config.js'
  import { Button, Fieldset } from '../ui/index.js'
  import type { SchemaBuilderProps } from './types.js'
  import { fieldsCardClass, fieldsGridClass, fieldsRowClass } from './variants.js'

  const DEFAULT_RULE_LABELS: Readonly<Record<string, string>> = {
    required: 'Обязательное',
    minLength: 'Мин. длина',
    maxLength: 'Макс. длина',
    minValue: 'Мин. значение',
    maxValue: 'Макс. значение',
    integer: 'Целое число',
    email: 'Всегда: проверка адреса почты',
    url: 'Всегда: проверка ссылки',
    pattern: 'Всегда: номер в формате +79991234567',
  }

  let {
    description,
    name = 'props',
    formId,
    submitLabel = 'Сохранить',
    submitTestId = 'save',
    errorTitle = 'Набор не сохранён',
    labels,
    ruleLabels = DEFAULT_RULE_LABELS,
    placeholder = 'например, «Ссылка»',
    lockStateKey,
    onSuccess,
    class: cls,
  }: SchemaBuilderProps = $props()

  const form = bindComponentForm(
    forms,
    untrack(() => description),
    untrack(() => ({
      live: 'on-submit' as const,
      lockStateKey,
      onSuccess,
    })),
  )

  // svelte-ignore state_referenced_locally
  const set = fieldSet(form, name, {
    labels: {
      label: labels?.label ?? 'Название поля',
      kind: labels?.kind ?? 'Вид',
      rules: labels?.rules ?? 'Правила',
    },
    rule: (r) => ruleLabels[r] ?? DEFAULT_RULE_LABELS[r] ?? r,
    placeholder,
  })

  const f = $derived(form.f[name])
</script>

<Form
  id={formId ?? description.id}
  {form}
  hiddenFields={form.hidden()}
  class={cn(fieldsCardClass, cls)}
>
  <!-- Enter в текстовом поле без JS нажимает ПЕРВУЮ submit-кнопку формы:
       скрытая кнопка гарантирует отправку `submit`, а не `Удалить` первой строки. -->
  <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
  <Common errors={form.common} title={errorTitle} />

  <Fieldset legend={f?.label} legendVariant="label" description={f?.help} class="gap-3" data-field={name}>
    {#each set.errors as e (e.id)}
      <p class="text-xs font-medium text-destructive" role="alert">{e.message}</p>
    {/each}

    {#each set.rows as row, i (row.key)}
      <div data-set-row={row.key} class={fieldsRowClass}>
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">Поле {i + 1}</span>
          <Button variant="ghost" size="xs" data-testid="remove-{row.key}" {...set.removeProps(row)}>
            Удалить
          </Button>
        </div>
        {#each row.errors as e (e.id)}
          <p class="text-xs font-medium text-destructive" role="alert">{e.message}</p>
        {/each}
        <div class={fieldsGridClass}>
          <Field of={row.label} />
          <Field of={row.kind} />
        </div>
        <Field of={row.rules} />
        {#if row.args.length}
          <div class={fieldsGridClass}>
            {#each row.args as a (a.name)}<Field of={a} />{/each}
          </div>
        {/if}
      </div>
    {/each}

    <div>
      <Button variant="outline" size="sm" data-testid="add-field" {...set.addProps()}>+ поле</Button>
    </div>
  </Fieldset>

  <Button type="submit" data-testid={submitTestId} {...form.intent('submit')} task={formTask(form.state)}>
    {submitLabel}
  </Button>
</Form>
