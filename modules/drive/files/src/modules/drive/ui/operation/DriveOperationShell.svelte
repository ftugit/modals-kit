<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Form } from '#core/lib/form/svelte/index.js'
  import type { BoundForm } from '#core/lib/form/svelte/index.js'
  import Common from '#core/ui/form/Common.svelte'
  import Field from '#core/ui/form/Field.svelte'
  import { Button } from '#core/ui/index.js'
  import DriveBackLink from './DriveBackLink.svelte'

  interface Props {
    op: string
    form: BoundForm
    title: string
    description: string
    submit: string
    destructive?: boolean
    returnTo: string
    disabled?: boolean
    children?: Snippet
  }

  let {
    op,
    form,
    title,
    description,
    submit,
    destructive = false,
    returnTo,
    disabled = false,
    children = undefined,
  }: Props = $props()

  // Скрытые поля операции (`parent_id`, `return_to`, `node_id`, …) живут в
  // описании формы, а не в разметке операции: без них POST теряет адрес
  // возврата и узел. Рисуем их здесь, чтобы каждая операция не повторяла список.
  const hiddenFields = $derived(form.description.fields.filter((field) => field.input === 'hidden'))
</script>

<Form
  id={form.description.id}
  form={form}
  hiddenFields={form.hidden()}
  class="flex w-full min-w-0 flex-col gap-3 text-left"
  data-testid={`drive-op-${op}`}
>
  <div class="flex min-w-0 flex-col gap-1">
    <h2 class="break-words text-base font-semibold leading-tight">{title}</h2>
    <p class="break-words text-sm text-muted-foreground">{description}</p>
  </div>

  <Common errors={form.common} title="Не получилось выполнить операцию" />

  {#each hiddenFields as hidden (hidden.name)}
    <Field of={form.field(hidden.name)!} />
  {/each}

  {#if children}
    {@render children()}
  {/if}

  <div class="flex flex-wrap items-center gap-3">
    <Button
      type="submit"
      variant={destructive ? 'destructive' : 'default'}
      size="sm"
      disabled={disabled}
    >
      {submit}
    </Button>
    <DriveBackLink href={returnTo} />
  </div>
</Form>
