<script lang="ts">
  // Самодостаточная форма заполнения записи по сохранённой схеме (`defineForm({ from })`)
  // поверх `#hooks/component-form`: рендерит динамические поля схемы + слот статических полей.
  import { untrack } from 'svelte'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { cn } from '../../utils'
  import Common from '../form/Common.svelte'
  import Field from '../form/Field.svelte'
  import { forms } from '../form/forms.config.js'
  import { Button } from '../ui/index.js'
  import type { SchemaFieldsProps } from './types.js'
  import { fieldsSurfaceVariants } from './variants.js'

  let {
    description,
    formId,
    submitLabel = 'Отправить',
    submitTestId = 'record-submit',
    errorTitle = 'Запись не сохранена',
    lockStateKey,
    onSuccess,
    extraFields,
    class: cls,
  }: SchemaFieldsProps = $props()

  const form = bindComponentForm(
    forms,
    untrack(() => description),
    untrack(() => ({
      live: 'on-submit' as const,
      lockStateKey,
      onSuccess,
    })),
  )
</script>

<Form
  id={formId ?? description.id}
  {form}
  hiddenFields={form.hidden()}
  class={cn(fieldsSurfaceVariants({ surface: 'card' }), cls)}
>
  <Common errors={form.common} title={errorTitle} />
  {#each form.from() as { item, f } (f.name)}
    <div data-preset={item.preset}>
      <Field of={f} />
    </div>
  {/each}
  {#if extraFields}
    {@render extraFields(form)}
  {/if}
  <Button type="submit" data-testid={submitTestId} task={formTask(form.state)}>
    {submitLabel}
  </Button>
</Form>
