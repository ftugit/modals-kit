<script lang="ts">
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import {
    transferUploadFormFor,
    type StorageReport,
    type UploadedDemoRecord,
  } from './forms.js'

  let {
    itemId,
    targetServer,
    onTransferred,
  }: {
    itemId: string
    targetServer: string
    onTransferred: (updated: UploadedDemoRecord, report?: StorageReport) => void
  } = $props()

  const initialId = untrack(() => itemId)
  const initialTarget = untrack(() => targetServer)
  const safeIdPart = initialId.replace(/[^a-z0-9_-]/gi, '').slice(0, 18)

  const form = bindComponentForm(forms, transferUploadFormFor(initialId, initialTarget), {
    instance: `upload_transfer:${safeIdPart}_${initialTarget}`,
    onSuccess: (res) => {
      const payload = res.data as
        | { item?: UploadedDemoRecord; storageReport?: StorageReport }
        | undefined
      if (payload?.item) {
        onTransferred(payload.item, payload.storageReport)
      }
    },
  })
</script>

<Form {form} hiddenFields={form.hidden()} class="inline-flex">
  <Field of={form.f.id} />
  <Field of={form.f.to_server} />
  <Button
    type="submit"
    variant="secondary"
    size="sm"
    task={formTask(form.state)}
    data-testid={`transfer-to-${targetServer}`}
  >
    → {targetServer}
  </Button>
</Form>
