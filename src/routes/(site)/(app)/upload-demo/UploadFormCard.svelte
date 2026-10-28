<script lang="ts">
  import { untrack } from 'svelte'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { checks, forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm, type FormUploadProgress } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { UploadDemoValues } from './demo-schema.js'
  import {
    createUploadBundleForm,
    type StorageReport,
    type StorageTelemetrySnapshot,
    type UploadedDemoRecord,
  } from './forms.js'

  let {
    demo,
    onUploaded,
    onProgress,
  }: {
    demo: UploadDemoValues
    onUploaded: (
      created: readonly UploadedDemoRecord[],
      report?: StorageReport,
      telemetry?: StorageTelemetrySnapshot,
    ) => void
    onProgress: (progress: FormUploadProgress) => void
  } = $props()

  const initialDemo = untrack(() => demo)
  const formDesc = createUploadBundleForm(initialDemo)

  const upload = bindComponentForm(forms, formDesc, {
    checks,
    onSuccess: (res) => {
      const payload = res.data as
        | {
            item?: UploadedDemoRecord
            items?: readonly UploadedDemoRecord[]
            storageReport?: StorageReport
            telemetry?: StorageTelemetrySnapshot
          }
        | undefined
      const created =
        payload?.items ?? (payload?.item ? [payload.item] : [])
      if (created.length > 0) {
        onUploaded(created, payload?.storageReport, payload?.telemetry)
      }
    },
  })

  $effect(() => {
    const p = upload.state.progress
    if (p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'ws-upload') {
      onProgress(p as FormUploadProgress)
    }
  })
</script>

<Form form={upload} hiddenFields={upload.hidden()} enctype="multipart/form-data" class="space-y-4">
  <Common errors={upload.common} />
  <div class="grid gap-4 sm:grid-cols-2">
    <Field of={upload.f.title} />
    <Field of={upload.f.custom_path} />
  </div>
  <Field of={upload.f.notes} />
  <Field of={upload.f.bundle} preview />
  <div class="grid gap-2 sm:grid-cols-2">
    <Field of={upload.f.allow_overwrite} />
    <Field of={upload.f.verify_integrity} />
  </div>

  <div class="flex items-center gap-3">
    <Button type="submit" task={formTask(upload.state)} data-testid="submit-upload">
      Отправить в {demo.server}
    </Button>
  </div>
</Form>
