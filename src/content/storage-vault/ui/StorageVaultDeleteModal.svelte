<script lang="ts">
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { storageVaultSchema } from '../schema.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'

  let { slotId, backHref = '/upload-demo/vault' }: { slotId: string; backHref?: string } = $props()

  const initialSlotId = untrack(() => slotId)
  const schema = storageVaultSchema
  const form = bindComponentForm(forms, schema.deleteFormFor(initialSlotId), {
    instance: `dv_del:${schema.scope}:${initialSlotId}`,
    onSuccess: () => {
      window.location.href = backHref
    },
  })
</script>

<div class="flex flex-col gap-4">
  <h2 class="text-lg font-semibold">Удалить сервер хранилища?</h2>
  <p class="text-sm text-muted-foreground">Сервер будет удалён из сейфа. Действие необратимо.</p>
  <Form {form} hiddenFields={form.hidden()} class="flex items-center gap-2">
    <Field of={form.f.slot_id} />
    <Button type="submit" variant="destructive" size="sm" task={formTask(form.state)} data-testid={`vault-delete-${slotId}`}>
      Удалить
    </Button>
    <Button type="button" variant="outline" size="sm" onclick={() => (window.location.href = backHref)}>
      Отмена
    </Button>
  </Form>
</div>
