<script lang="ts">
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import { Steps, type StepsHost } from '#components/steps/index.js'
  import ProfileStep from './ProfileStep.svelte'
  import SecurityStep from './SecurityStep.svelte'
  import { Badge, Button } from '#components/ui/index.js'
  import {
    CONFIG_GROUPS,
    CONFIG_GROUP_ORDER,
    specConfig,
    type ConfigGroupKey,
  } from '../../spec-config.js'
  import type { UserConfigItem, UserConfigSlice } from '../../types.js'
  import { userSession } from '../../vault.svelte.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { createUserConfigDescription, USER_CONFIG_FORM_ID } from './form.js'

  interface Props {
    slice: UserConfigSlice
    steps: StepsHost
    showStepsNav: boolean
    /** `false` — шаги рисует внешний `Surface.controls`, фильтрация групп остаётся. */
    embedSteps?: boolean
    action?: string
    form?: { result?: Result } | null
    doneHref?: string
    onResetSlice?: (next: UserConfigSlice) => void
    onSaved?: (next: UserConfigSlice) => void
    onClose?: () => void
  }

  let {
    slice,
    steps,
    showStepsNav,
    embedSteps = true,
    action,
    form,
    doneHref = '/',
    onResetSlice,
    onSaved,
    onClose,
  }: Props = $props()

  const desc = createUserConfigDescription(
    untrack(() => slice.items.filter((i) => i.editable)),
  )

  const bound = bindComponentForm(forms, desc, {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  const fieldMap = $derived(bound.f as unknown as Record<string, FieldView | undefined>)

  mirrorToField(bound as never, 'subject', () => (slice.isOwn ? '' : slice.uid))

  // bindComponentForm также поднимает page.data.formResult после нативного
  // POST, даже когда носитель не передал form явно.
  const hasFailedContinuation = untrack(() => Boolean(bound.state.result && !bound.state.result.ok))
  for (const initialItem of untrack(() => slice.items)) {
    if (!initialItem.editable) continue
    const key = initialItem.key
    const view = bound.field(initialItem.fieldName)
    let lastServerVal = initialItem.value
    if (!hasFailedContinuation) untrack(() => view?.onInput(lastServerVal))
    $effect(() => {
      const nextVal = slice.items.find((x) => x.key === key)?.value
      if (!Object.is(nextVal, lastServerVal)) {
        lastServerVal = nextVal
        untrack(() => view?.onInput(nextVal))
      }
    })
  }

  const visibleGroups = $derived(
    CONFIG_GROUP_ORDER.map((groupKey) => ({
      key: groupKey,
      meta: CONFIG_GROUPS[groupKey],
      items: slice.items.filter((item) => item.group === groupKey),
    })).filter((g) => g.items.length > 0),
  )

  const activeGroup = $derived<ConfigGroupKey>(
    (steps.currentKey as ConfigGroupKey | null) ?? visibleGroups[0]?.key ?? 'profile',
  )



  let lastHandledSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r || r.submissionId === lastHandledSubmission) return
    if (!r.ok) {
      const firstPath = r.errors.find((e) => e.path)?.path
      if (firstPath && showStepsNav) {
        const hit = slice.items.find((i) => i.fieldName === firstPath)
        if (hit && hit.group !== steps.currentKey) {
          steps.set(hit.group)
        }
      }
      return
    }
    const data = r.data as { step?: string; action?: 'save' | 'reset'; slice?: UserConfigSlice } | undefined
    if (data?.step === 'done' && data.slice) {
      lastHandledSubmission = r.submissionId
      if (data.action === 'reset') {
        onResetSlice?.(data.slice)
      } else {
        onSaved?.(data.slice)
      }
    }
  })
</script>

<Form
  id={USER_CONFIG_FORM_ID}
  form={bound}
  hiddenFields={bound.hidden()}
  class="flex w-full flex-col gap-4 text-left"
>
  <Common errors={bound.common} title="Проверьте параметры" />

  <div hidden aria-hidden="true"><Field of={bound.f.subject} /></div>

  {#if showStepsNav && embedSteps}
    <Steps host={steps} label="Разделы настроек" />
  {/if}

  {#if visibleGroups.some((g) => g.key === 'profile')}
    <ProfileStep
      items={visibleGroups.find((g) => g.key === 'profile')!.items}
      {fieldMap}
      {slice}
      {bound}
      active={activeGroup === 'profile'}
      {showStepsNav}
    />
  {/if}
  {#if visibleGroups.some((g) => g.key === 'security')}
    <SecurityStep
      items={visibleGroups.find((g) => g.key === 'security')!.items}
      {fieldMap}
      {slice}
      {bound}
      active={activeGroup === 'security'}
      {showStepsNav}
    />
  {/if}

  <div class="flex items-center justify-between gap-2 pt-1">
    {#if slice.canSave}
      <Button
        type="submit"
        name="intent"
        value="save"
        task={formTask(bound.state, 'save')}
        data-testid="config-save-submit"
      >
        {specConfig.saveButton}
      </Button>
    {:else}
      <span></span>
    {/if}
    <Button
      href={doneHref}
      variant="ghost"
      onclick={(e: MouseEvent) => {
        if (!onClose) return
        e.preventDefault()
        onClose()
      }}
    >
      {specConfig.cancelButton}
    </Button>
  </div>
</Form>
