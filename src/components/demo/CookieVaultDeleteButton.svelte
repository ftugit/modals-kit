<script lang="ts" generics="TMeta = Record<string, unknown>">
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import type {
    CookieVaultSchema,
    CookieVaultSnapshot,
  } from '#hooks/cookie-vault/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'

  let {
    schema,
    slotId,
    onDeleted,
  }: {
    schema: CookieVaultSchema<unknown, TMeta>
    slotId: string
    onDeleted: (snapshot: CookieVaultSnapshot<TMeta>) => void
  } = $props()

  const initialId = untrack(() => slotId)
  const initialSchema = untrack(() => schema)

  const form = bindComponentForm(forms, initialSchema.deleteFormFor(initialId), {
    instance: `dv_del:${initialSchema.scope}:${initialId}`,
    onSuccess: (res) => {
      const payload = res.data as { snapshot?: CookieVaultSnapshot<TMeta> } | undefined
      if (payload?.snapshot) onDeleted(payload.snapshot)
    },
  })
</script>

<Form {form} hiddenFields={form.hidden()} class="inline-flex">
  <Field of={form.f.slot_id} />
  <Button
    type="submit"
    variant="outline"
    size="sm"
    task={formTask(form.state)}
    data-testid={`vault-delete-${slotId}`}
  >
    Удалить
  </Button>
</Form>
