<script lang="ts">
  import { untrack } from 'svelte'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import type { DriveOperationData } from '../../types.js'
  import { DRIVE_OPERATIONS } from '../../operations.js'
  import { driveStarForm } from '../../forms/index.js'
  import DriveOperationShell from '../operation/DriveOperationShell.svelte'
  import { useDriveOperation } from '../operation/use-drive-operation.svelte.js'

  interface Props {
    initial: DriveOperationData
    form?: { result?: Result } | null
    onDone?: () => void
  }

  let { initial, form = null, onDone }: Props = $props()
  const spec = untrack(() => DRIVE_OPERATIONS.star)
  const bound = bindComponentForm(forms, untrack(() => driveStarForm(initial)), {
    action: untrack(() => initial.action),
    continuation: untrack(() => form?.result ?? undefined),
  })
  useDriveOperation({ op: 'star', form: bound, onDone: () => onDone?.() })
</script>

<DriveOperationShell
  op="star"
  form={bound}
  title={spec.title}
  description={spec.description}
  submit={spec.submit}
  returnTo={initial.returnTo}
/>
