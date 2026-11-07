<script lang="ts">
  /**
   * Общая форма сервера S3 / WebDAV.
   * Пул и куки-сейф передают свой `BoundForm` (разные `id`) и свою подпись отправки.
   * Кнопка отправки остаётся в теле, не в шапке.
   */
  import type { Snippet } from 'svelte'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { Button, Surface } from '#components/ui/index.js'
  import { Form, formTask, type BoundForm } from '#lib/form/svelte/index.js'

  interface Props {
    /** Уже привязанная форма. Владелец привязки — экран, чтобы `delete:<id>` и `reset-key` делили один `formEl`. */
    form: BoundForm
    /** HTML `id` формы. Внешние кнопки ссылаются на него через атрибут `form`. */
    formId: string
    withPriority?: boolean
    submitLabel: string
    editId?: string | null
    /** Показать сброс ключа шифрования. Только пул, и только если ключ уже задан. */
    showClearKey?: boolean
    title?: string
    onSaved?: (data: unknown) => void
    formTestId?: string
    submitTestId?: string
    class?: string
    /** Кнопки шапки карточки формы («Новый слот»). */
    controls?: Snippet
    /** Ряд справа от отправки («Закрыть»). */
    actions?: Snippet
    /** Список слотов: внутри той же формы, чтобы `delete:<id>` не заводил вторую. */
    children?: Snippet
  }

  let {
    form,
    formId,
    withPriority = false,
    submitLabel,
    editId = null,
    showClearKey = false,
    title,
    onSaved,
    formTestId = 'storage-server-form',
    submitTestId = 'storage-server-save',
    class: className,
    controls,
    actions,
    children,
  }: Props = $props()

  const fields = $derived(form.f as Record<string, (typeof form.f)[string]>)

  let lastSubmission = ''
  $effect(() => {
    const result = form.state.result
    if (!onSaved || !result?.ok || result.submissionId === lastSubmission) return
    lastSubmission = result.submissionId
    onSaved(result.data)
  })
</script>

<Form
  id={formId}
  {form}
  hiddenFields={form.hidden()}
  class="flex flex-col gap-5"
  data-testid={formTestId}
>
  {@render children?.()}

  <Surface variant="card" class={className} {title} {controls} scroll={false}>
    <Common errors={form.common} title="Не удалось сохранить сервер" />

    {#if fields.server_id}
      <div hidden aria-hidden="true"><Field of={fields.server_id} /></div>
    {/if}
    {#if !editId}
      <Field of={fields.slot} />
    {/if}
    <Field of={fields.url} />
    <Field of={fields.encryption_key} />
    {#if editId && showClearKey && fields.clear_encryption_key}
      <Field of={fields.clear_encryption_key} />
    {/if}

    <div class={withPriority ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}>
      <Field of={fields.storage_mb} />
      <Field of={fields.file_mb} />
      {#if withPriority && fields.priority}
        <Field of={fields.priority} />
      {/if}
    </div>

    <Field of={fields.allow_split} />
    <Field of={fields.read_only} />

    <div class="flex items-center justify-between gap-2 pt-1">
      <Button
        type="submit"
        name="intent"
        value="save"
        task={formTask(form.state, 'save')}
        data-testid={submitTestId}
      >
        {submitLabel}
      </Button>
      {@render actions?.()}
    </div>
  </Surface>
</Form>
