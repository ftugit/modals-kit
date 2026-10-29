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
  import { Badge, Button } from '#components/ui/index.js'
  import {
    CONFIG_GROUPS,
    CONFIG_GROUP_ORDER,
    formatConfigValue,
    isConfigKey,
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

  for (const initialItem of untrack(() => slice.items)) {
    if (!initialItem.editable) continue
    const key = initialItem.key
    const fname = initialItem.fieldName
    if (!bound.state.result) {
      mirrorToField(bound as never, fname, () => {
        const cur = slice.items.find((x) => x.key === key)
        return cur ? cur.value : initialItem.value
      })
    }
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

  function displayValue(item: UserConfigItem, val: unknown): string {
    return isConfigKey(item.key) ? formatConfigValue(item.key, val) : String(val ?? '')
  }

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

  {#if showStepsNav}
    <Steps host={steps} label="Разделы настроек" />
  {/if}

  {#each visibleGroups as grp (grp.key)}
    <div
      class="flex flex-col gap-3"
      class:hidden={showStepsNav && activeGroup !== grp.key}
      data-config-group={grp.key}
    >
      <div class="flex flex-col gap-0.5">
        <h3 class="text-sm font-semibold">{grp.meta.title}</h3>
        <p class="text-xs text-muted-foreground">{grp.meta.description}</p>
      </div>

      {#each grp.items as item (item.key)}
        {@const fv = item.editable ? fieldMap[item.fieldName] : undefined}
        {#if item.editable && fv}
          <div
            class="flex flex-col gap-2 rounded-lg border border-border p-3"
            data-testid={`config-item-${item.key}`}
            data-config-editable="true"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge variant={item.overridden ? 'secondary' : 'outline'}>
                  {item.overridden ? specConfig.overriddenBadge : specConfig.defaultBadge}
                </Badge>
                {#if item.overridden}
                  <span class="text-xs text-muted-foreground">
                    По умолчанию: {displayValue(item, item.defaultValue)}
                  </span>
                {/if}
              </div>
              {#if item.overridden && item.deletable}
                <Button
                  type="submit"
                  name="intent"
                  value={`reset:${item.key}`}
                  variant="ghost"
                  size="sm"
                  task={formTask(bound.state, `reset:${item.key}`)}
                  data-testid={`config-reset-${item.key}`}
                >
                  {specConfig.resetButton}
                </Button>
              {/if}
            </div>
            <Field of={fv} />
          </div>
        {:else}
          <div
            class="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-3 opacity-85"
            aria-readonly="true"
            data-testid={`config-readonly-${item.key}`}
            data-config-editable="false"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium">{item.title}</span>
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{specConfig.readOnlyBadge}</Badge>
                <Badge variant={item.overridden ? 'secondary' : 'outline'}>
                  {item.overridden ? specConfig.adminSetBadge : specConfig.defaultBadge}
                </Badge>
              </div>
            </div>
            <p class="text-xs text-muted-foreground">{item.description}</p>
            <div
              class="mt-1 rounded-md border border-border/70 bg-background/70 px-2.5 py-1.5 text-sm font-medium text-foreground"
              role="status"
              data-testid={`config-readonly-value-${item.key}`}
            >
              {displayValue(item, item.value)}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/each}

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
