<script lang="ts">
  import { untrack } from 'svelte'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import Field from '#core/ui/form/Field.svelte'
  import { Button } from '#core/ui/index.js'
  import type { DriveOperationData } from '../../types.js'
  import { DRIVE_OPERATIONS, driveOperationHref } from '../../operations.js'
  import { drivePickerHref } from '../../routes.js'
  import { driveCopyForm } from '../../forms/index.js'
  import DriveOperationShell from '../operation/DriveOperationShell.svelte'
  import { drivePickerChannel, isSingleDriveTarget } from '../operation/picker-channel.js'
  import { useDriveOperation } from '../operation/use-drive-operation.svelte.js'

  interface Props {
    initial: DriveOperationData
    form?: { result?: Result } | null
    onDone?: () => void
  }

  let { initial, form = null, onDone }: Props = $props()
  const spec = untrack(() => DRIVE_OPERATIONS.copy)
  const bound = bindComponentForm(forms, untrack(() => driveCopyForm(initial)), {
    action: untrack(() => initial.action),
    continuation: untrack(() => form?.result ?? undefined),
  })
  useDriveOperation({ op: 'copy', form: bound, onDone: () => onDone?.() })

  const m = tryUseModals()
  const asModalLink = m ? useModalLink() : null
  let targetLabel = $state(untrack(() => initial.values.targetLabel))
  const targetId = $derived(String(bound.f.target_id.value ?? '') || null)
  const from = $derived(
    driveOperationHref('copy', {
      nodeId: initial.node?.id ?? null,
      returnTo: initial.returnTo,
      targetId,
    }),
  )
  const pickerHref = $derived(
    drivePickerHref({ from, param: 'target_id', kind: 'folder', mode: 'single', folder: targetId }),
  )
  const pickerLink = $derived(
    asModalLink
      ? asModalLink(
          'drive.picker',
          { from, param: 'target_id', kind: 'folder', mode: 'single', folder: targetId },
          { href: pickerHref },
        )
      : asLink(pickerHref),
  )

  let lastSeq = 0
  $effect(() => {
    const raw = m?.view.sharedData[drivePickerChannel('target_id')]
    if (!isSingleDriveTarget(raw) || raw.seq <= lastSeq) return
    lastSeq = raw.seq
    bound.f.target_id.onInput(raw.id ?? '')
    targetLabel = raw.label
  })
</script>

<DriveOperationShell
  op="copy"
  form={bound}
  title={spec.title}
  description={spec.description}
  submit={spec.submit}
  returnTo={initial.returnTo}
>
  <div class="flex flex-col gap-1.5">
    <span class="text-sm font-medium">Куда скопировать</span>
    <p class="text-sm text-muted-foreground" data-testid="drive-target-label">{targetLabel}</p>
    <div>
      <Button {...pickerLink} variant="outline" size="sm">Выбрать папку</Button>
    </div>
  </div>
  <Field of={bound.f.name} />
</DriveOperationShell>
