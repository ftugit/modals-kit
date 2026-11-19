<script lang="ts">
  import { untrack } from 'svelte'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import Field from '#core/ui/form/Field.svelte'
  import type { DriveOperationData } from '../../types.js'
  import { DRIVE_OPERATIONS } from '../../operations.js'
  import { driveUploadForm } from '../../forms/index.js'
  import { driveMessage } from '../../messages.js'
  import DriveOperationShell from '../operation/DriveOperationShell.svelte'
  import { useDriveOperation } from '../operation/use-drive-operation.svelte.js'

  interface Props {
    initial: DriveOperationData
    form?: { result?: Result } | null
    onDone?: () => void
  }

  let { initial, form = null, onDone }: Props = $props()
  const spec = untrack(() => DRIVE_OPERATIONS.upload)
  const bound = bindComponentForm(forms, untrack(() => driveUploadForm(initial)), {
    action: untrack(() => initial.action),
    continuation: untrack(() => form?.result ?? undefined),
  })
  useDriveOperation({ op: 'upload', form: bound, onDone: () => onDone?.() })
</script>

<DriveOperationShell
  op="upload"
  form={bound}
  title={spec.title}
  description={spec.description}
  submit={spec.submit}
  returnTo={initial.returnTo}
  disabled={initial.storageError !== null}
>
  {#if initial.storageError === null}
    <Field of={bound.f.file} />
  {:else}
    <p class="rounded-lg border border-border p-3 text-sm text-muted-foreground" role="alert">
      {driveMessage(initial.storageError)}
    </p>
  {/if}
</DriveOperationShell>
