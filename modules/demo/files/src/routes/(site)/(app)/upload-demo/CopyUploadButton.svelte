<script lang="ts">
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import {
    copyUploadFormFor,
    type StorageReport,
    type StorageTelemetrySnapshot,
    type UploadedDemoRecord,
  } from './forms.js'

  let {
    itemId,
    targetServer,
    onCopied,
  }: {
    itemId: string
    targetServer: string
    onCopied: (
      updated: UploadedDemoRecord,
      report?: StorageReport,
      telemetry?: StorageTelemetrySnapshot,
    ) => void
  } = $props()

  const initialId = untrack(() => itemId)
  const initialTarget = untrack(() => targetServer)
  const safeIdPart = initialId.replace(/[^a-z0-9_-]/gi, '').slice(0, 18)

  const form = bindComponentForm(forms, copyUploadFormFor(initialId, initialTarget), {
    instance: `upload_copy:${safeIdPart}_${initialTarget}`,
    onSuccess: (res) => {
      const payload = res.data as
        | {
            item?: UploadedDemoRecord
            storageReport?: StorageReport
            telemetry?: StorageTelemetrySnapshot
          }
        | undefined
      if (payload?.item) {
        onCopied(payload.item, payload.storageReport, payload.telemetry)
      }
    },
  })
</script>

<Form {form} hiddenFields={form.hidden()} class="inline-flex">
  <Field of={form.f.id} />
  <Field of={form.f.to_server} />
  <Button
    type="submit"
    variant="outline"
    size="sm"
    task={formTask(form.state)}
    data-testid={`copy-to-${targetServer}`}
  >
    + копия в {targetServer}
  </Button>
</Form>
