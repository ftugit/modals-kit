<script lang="ts">
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { deleteUploadFormFor } from './forms.js'

  let {
    itemId,
    onRemoved,
  }: {
    itemId: string
    onRemoved: (id: string) => void
  } = $props()

  const initialId = untrack(() => itemId)
  const form = bindComponentForm(forms, deleteUploadFormFor(initialId), {
    instance: `upload_delete:${initialId.slice(0, 24)}`,
    onSuccess: () => onRemoved(initialId),
  })
</script>

<Form {form} hiddenFields={form.hidden()} class="inline-flex">
  <Field of={form.f.id} />
  <Button type="submit" variant="outline" size="sm" task={formTask(form.state)} data-testid="delete-upload">
    Удалить
  </Button>
</Form>
