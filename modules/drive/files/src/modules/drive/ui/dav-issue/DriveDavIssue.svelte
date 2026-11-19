<script lang="ts">
  import { untrack } from 'svelte'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import Field from '#core/ui/form/Field.svelte'
  import type { DriveOperationData } from '../../types.js'
  import { DRIVE_OPERATIONS } from '../../operations.js'
  import { driveDavIssueForm } from '../../forms/index.js'
  import DriveOperationShell from '../operation/DriveOperationShell.svelte'
  import DriveBackLink from '../operation/DriveBackLink.svelte'
  import { useDriveOperation } from '../operation/use-drive-operation.svelte.js'

  interface Props {
    initial: DriveOperationData
    form?: { result?: Result } | null
    onDone?: () => void
  }

  let { initial, form = null, onDone }: Props = $props()
  const spec = untrack(() => DRIVE_OPERATIONS['dav-issue'])
  const bound = bindComponentForm(forms, untrack(() => driveDavIssueForm(initial)), {
    action: untrack(() => initial.action),
    continuation: untrack(() => form?.result ?? undefined),
  })
  useDriveOperation({ op: 'dav-issue', form: bound, onDone: () => onDone?.() })

  const token = $derived.by(() => {
    const data = bound.state.result?.data as { token?: unknown } | undefined
    return typeof data?.token === 'string' ? data.token : ''
  })
</script>

{#if token}
  <div class="flex flex-col gap-3" data-testid="drive-op-done-dav-issue">
    <h2 class="text-base font-semibold leading-tight">Готово</h2>
    <p class="text-sm text-muted-foreground">
      Скопируйте пароль сейчас: сервер хранит только HMAC, повторно он не покажется.
    </p>
    <code
      class="block w-full select-all break-all rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs"
      data-testid="drive-dav-token"
    >
      {token}
    </code>
    <DriveBackLink href={initial.returnTo} />
  </div>
{:else}
  <DriveOperationShell
    op="dav-issue"
    form={bound}
    title={spec.title}
    description={spec.description}
    submit={spec.submit}
    returnTo={initial.returnTo}
  >
    <Field of={bound.f.label} />
  </DriveOperationShell>
{/if}
