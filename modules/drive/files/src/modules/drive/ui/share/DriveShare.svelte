<script lang="ts">
  import { untrack } from 'svelte'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import Field from '#core/ui/form/Field.svelte'
  import { Button, Input } from '#core/ui/index.js'
  import { USER_PICKER_CHANNEL_PREFIX, type UserPickerPayload } from '#modules/user/accounts/svelte/UserPicker.svelte'
  import type { DriveOperationData } from '../../types.js'
  import { DRIVE_OPERATIONS, driveOperationHref } from '../../operations.js'
  import { driveShareForm } from '../../forms/index.js'
  import DriveOperationShell from '../operation/DriveOperationShell.svelte'
  import { useDriveOperation } from '../operation/use-drive-operation.svelte.js'

  interface Props {
    initial: DriveOperationData
    form?: { result?: Result } | null
    onDone?: () => void
  }

  let { initial, form = null, onDone }: Props = $props()
  const spec = untrack(() => DRIVE_OPERATIONS.share)
  const bound = bindComponentForm(forms, untrack(() => driveShareForm(initial)), {
    action: untrack(() => initial.action),
    continuation: untrack(() => form?.result ?? undefined),
  })
  useDriveOperation({ op: 'share', form: bound, onDone: () => onDone?.() })

  const m = tryUseModals()
  const asModalLink = m ? useModalLink() : null
  const operationUrl = $derived(
    driveOperationHref('share', {
      nodeId: initial.node?.id ?? null,
      returnTo: initial.returnTo,
    }),
  )
  const selected = $derived.by(() => {
    const value = bound.f.subjects.value
    return Array.isArray(value) ? value.map(String).filter(Boolean) : []
  })
  const subjectOptions = $derived.by(() => {
    const known = initial.subjectOptions ?? []
    const seen = new Set(known.map((item) => item.value))
    return [
      ...known,
      ...selected
        .filter((id) => !seen.has(id))
        .map((id) => ({ value: id, label: id })),
    ]
  })
  const subjectsField = $derived.by(() => {
    const base = bound.f.subjects
    const clone = { ...base, options: subjectOptions } as typeof base
    for (const sym of Object.getOwnPropertySymbols(base)) {
      ;(clone as unknown as Record<symbol, unknown>)[sym] = (
        base as unknown as Record<symbol, unknown>
      )[sym]
    }
    return clone
  })
  const pickerHref = $derived.by(() => {
    const query = new URLSearchParams({
      mode: 'multiple',
      param: 'subjects',
      from: operationUrl,
    })
    if (selected.length) query.set('picked', selected.join(','))
    return `/users/pick?${query.toString()}`
  })
  const pickerLink = $derived(
    asModalLink
      ? asModalLink(
          'user.picker',
          { mode: 'multiple', channel: 'drive.share.subjects', picked: selected.join(',') },
          { href: pickerHref },
        )
      : asLink(pickerHref),
  )

  let lastSeq = 0
  $effect(() => {
    const raw = m?.view.sharedData[
      `${USER_PICKER_CHANNEL_PREFIX}drive.share.subjects`
    ] as UserPickerPayload | undefined
    if (!raw || raw.seq <= lastSeq) return
    lastSeq = raw.seq
    bound.f.subjects.onInput(raw.ids.filter(Boolean))
  })

  let manual = $state('')
  function addManual() {
    const id = manual.trim()
    if (!id || selected.includes(id)) return
    bound.f.subjects.onInput([...selected, id])
    manual = ''
  }
</script>

<DriveOperationShell
  op="share"
  form={bound}
  title={spec.title}
  description={spec.description}
  submit={spec.submit}
  returnTo={initial.returnTo}
>
  <div class="flex flex-col gap-2">
    <Field of={subjectsField} />
    <div class="flex flex-wrap items-center gap-2">
      <Button {...pickerLink} variant="outline" size="sm">
        Выбрать пользователей{#if selected.length}&nbsp;({selected.length}){/if}
      </Button>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Input
        bind:value={manual}
        placeholder="UUID получателя"
        class="min-w-0 flex-1 font-mono text-xs"
        data-testid="drive-share-manual-uid"
      />
      <Button type="button" variant="outline" size="sm" onclick={addManual}>Добавить UUID</Button>
    </div>
  </div>
  <Field of={bound.f.role} />
</DriveOperationShell>
