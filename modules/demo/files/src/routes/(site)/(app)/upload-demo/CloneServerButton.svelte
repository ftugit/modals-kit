<script lang="ts">
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import {
    cloneServerFormFor,
    type StorageCloneReport,
    type StorageReport,
    type StorageTelemetrySnapshot,
    type UploadedDemoRecord,
  } from './forms.js'

  let {
    fromServer,
    toServer,
    onCloned,
  }: {
    fromServer: string
    toServer: string
    onCloned?: (
      report: StorageCloneReport,
      items?: readonly UploadedDemoRecord[],
      storageReport?: StorageReport,
      telemetry?: StorageTelemetrySnapshot,
    ) => void
  } = $props()

  const initialFrom = untrack(() => fromServer)
  const initialTo = untrack(() => toServer)
  let cloneResult = $state<StorageCloneReport | null>(null)

  const form = bindComponentForm(forms, cloneServerFormFor(initialFrom, initialTo), {
    instance: `clone:${initialFrom}_${initialTo}`,
    onSuccess: (res) => {
      const payload = res.data as
        | {
            cloneReport?: StorageCloneReport
            items?: readonly UploadedDemoRecord[]
            storageReport?: StorageReport
            telemetry?: StorageTelemetrySnapshot
          }
        | undefined
      if (payload?.cloneReport) {
        cloneResult = payload.cloneReport
        onCloned?.(
          payload.cloneReport,
          payload.items,
          payload.storageReport,
          payload.telemetry,
        )
      }
    },
  })
</script>

<div class="flex flex-col gap-1">
  <Form {form} hiddenFields={form.hidden()} class="inline-flex">
    <Field of={form.f.from_server} />
    <Field of={form.f.to_server} />
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      task={formTask(form.state)}
      data-testid={`clone-btn-${fromServer}-to-${toServer}`}
    >
      Клон → {toServer}
    </Button>
  </Form>

  {#if cloneResult}
    <div
      class="rounded border border-border/60 bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground"
      data-testid={`clone-result-${fromServer}`}
    >
      клонировано: {cloneResult.clonedPaths.length} · пропущено: {cloneResult.skippedPaths.length}
    </div>
  {/if}
</div>
