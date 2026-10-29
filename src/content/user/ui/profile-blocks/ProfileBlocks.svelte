<script lang="ts">
  /**
   * Раздел блокировок в профиле цели (этап 9): активные записи, история
   * и форма наложения. Показ и право считает домен (`ProfileRead.blocks`
   * и `canBlock` приходят данными носителя) — здесь только рисунок.
   * Срок: чекбокс «навсегда» или дата; с JS пара «число + отсечка»
   * меняет поле даты, серверу едут только дата и чекбокс.
   */
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { blockActive, describeBlockScope, specBlocks } from '../../spec-block.js'
  import type { BlockView } from '../../types.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import BlockLift from './BlockLift.svelte'
  import { blocksForm } from './form.js'

  interface Props {
    /** id аккаунта-цели. */
    subject: string
    blocks: BlockView[]
    canBlock: boolean
    class?: string
  }

  let { subject, blocks, canBlock: viewerCanBlock, class: className }: Props = $props()

  const bound = bindComponentForm(forms, blocksForm, {})
  mirrorToField(bound, 'subject', () => subject)

  const now = Date.now()
  const active = $derived(blocks.filter((b) => blockActive({ scope: b.scope, reason: b.reason, at: b.at, until: b.until ?? undefined }, now)))
  const history = $derived(blocks.filter((b) => !active.includes(b)))

  // JS-помощь сроку: число + отсечка пересчитывают поле даты.
  let durationCount = $state(7)
  let durationUnit = $state('days')
  $effect(() => {
    const n = bound.f.dur_n.value
    const u = bound.f.dur_unit.value
    if (n != null && n !== '' && u) {
      durationCount = Number(n) || 7
      durationUnit = String(u)
      applyDuration()
    }
  })
  const UNIT_MS: Record<string, number> = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 604_800_000,
    months: 2_592_000_000,
    years: 31_536_000_000,
  }
  function applyDuration(): void {
    const ms = (UNIT_MS[durationUnit] ?? 86_400_000) * Math.max(1, durationCount || 1)
    const d = new Date(Date.now() + ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    bound.f.until.onInput(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    )
  }
</script>

<section class={cn('flex w-full flex-col gap-4 text-left', className)} data-testid="profile-blocks">
  <h3 class="text-base font-semibold">{specBlocks.title}</h3>

  <div class="flex flex-col gap-2">
    <h4 class="text-sm font-medium">{specBlocks.activeTitle}</h4>
    {#if active.length === 0}
      <p class="text-sm text-muted-foreground">{specBlocks.noActive}</p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each active as b (b.id)}
          <li class="flex items-start justify-between gap-3 rounded-md border p-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{describeBlockScope(b.scope).title}</span>
              <span class="text-sm">{b.reason}</span>
              <span class="text-xs text-muted-foreground">
                {b.until ? specBlocks.untilText(b.until) : specBlocks.foreverText}
                {#if b.by} · {specBlocks.byText(b.by)}{/if}
              </span>
            </div>
            {#if viewerCanBlock}
              <BlockLift {subject} blockId={b.id} />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if history.length}
    <div class="flex flex-col gap-2 opacity-60">
      <h4 class="text-sm font-medium">{specBlocks.historyTitle}</h4>
      <ul class="flex flex-col gap-1">
        {#each history as b (b.id)}
          <li class="text-sm">
            {describeBlockScope(b.scope).title} — {b.reason}
            <span class="text-xs text-muted-foreground">({specBlocks.expiredText})</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if viewerCanBlock}
    <div class="flex flex-col gap-3 border-t pt-4">
      <h4 class="text-sm font-medium">{specBlocks.addTitle}</h4>
      <Form id="user-profile-blocks" form={bound} class="flex flex-col gap-3">
        <Common errors={bound.common} title="Проверьте форму" />
        <Field of={bound.f.scope} />
        <Field of={bound.f.reason} />
        <Field of={bound.f.forever} />
        <Field of={bound.f.until} />
        <div class="flex items-end gap-2">
          <Field of={bound.f.dur_n} />
          <Field of={bound.f.dur_unit} />
        </div>
        <div>
          <Button type="submit" name="intent" value="add" task={formTask(bound.state, 'add')}>
            {specBlocks.addButton}
          </Button>
        </div>
      </Form>
    </div>
  {/if}
</section>
