<script lang="ts">
  import { formTask } from '#lib/form/svelte/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import { Badge, Button } from '#components/ui/index.js'
  import Field from '#components/form/Field.svelte'
  import {
    formatConfigValue,
    isConfigKey,
    specConfig,
    type ConfigGroupKey,
  } from '../../spec-config.js'
  import type { UserConfigItem, UserConfigSlice } from '../../types.js'

  interface Props {
    groupKey: ConfigGroupKey
    title: string
    description: string
    items: UserConfigItem[]
    fieldMap: Record<string, FieldView | undefined>
    slice: UserConfigSlice
    bound: any
    active?: boolean
    showStepsNav?: boolean
  }

  let {
    groupKey,
    title,
    description,
    items,
    fieldMap,
    slice,
    bound,
    active = true,
    showStepsNav = false,
  }: Props = $props()

  function displayValue(item: UserConfigItem, val: unknown): string {
    return isConfigKey(item.key) ? formatConfigValue(item.key, val) : String(val ?? '')
  }
</script>

<div
  class="flex flex-col gap-3"
  class:hidden={showStepsNav && !active}
  data-config-group={groupKey}
>
  <div class="flex flex-col gap-0.5">
    <h3 class="text-sm font-semibold">{title}</h3>
    <p class="text-xs text-muted-foreground">{description}</p>
  </div>

  {#each items as item (item.key)}
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
