<script lang="ts">
  /**
   * Единица наборных действий над блокировками (`user.blocks.bulk`):
   * подтверждение набора `ids` или среза списка.
   *
   * Правило успеха (§6.1): результат остаётся в носителе — адрес не меняется,
   * слой сам не закрывается. Переход объявлен только в регистрации формы и
   * случается лишь без JS.
   *
   * Слова исхода разные: «снять» заканчивает срок и оставляет историю,
   * «удалить» ставит метку мягкого удаления. Обещает это и текст.
   */
  import { untrack } from 'svelte'
  import { Form } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { asLink } from '#hooks/links/index.js'
  import { cn } from '#components/utils.js'
  import { invalidatePaginator } from '#lib/paginate/index.js'
  import { blocksListRoute } from '../../routes.js'
  import type { BlocksBulkRouteData } from '../../types.js'
  import { userSession } from '../../vault.svelte.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { BLOCKS_NAME } from '../blocks-list/source.js'
  import {
    BLOCKS_SLICE_KEYS,
    blocksBulkForm,
    blocksBulkSummary,
    sliceFieldName,
    type BlocksBulkIntent,
  } from './form.js'

  interface Props {
    /** Явный набор: отмеченные строки списка. */
    ids?: readonly string[]
    /** Непустой срез: значения фильтров, которые принёс носитель. */
    sliceFields?: Readonly<Record<string, string>> | null
    initial?: BlocksBulkRouteData | null
    action?: string
    form?: { result?: Result } | null
    doneHref?: string
    onDone?: () => void
    class?: string
  }

  let {
    ids = [],
    sliceFields = null,
    initial = null,
    action,
    form,
    doneHref,
    onDone,
    class: className,
  }: Props = $props()

  const slice = $derived(
    Boolean(sliceFields) && Object.values(sliceFields ?? {}).some((v) => String(v).trim() !== ''),
  )
  const count = $derived(slice ? Number(initial?.count ?? 0) : ids.length)
  const holdSeconds = $derived(initial?.holdSeconds ?? 2)

  const lift = $derived(blocksBulkSummary({ count, slice }, 'lift'))
  const remove = $derived(blocksBulkSummary({ count, slice }, 'delete'))

  const bound = bindComponentForm(forms, blocksBulkForm(), {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  mirrorToField(bound, 'ids', () => ids.join(','))
  for (const key of BLOCKS_SLICE_KEYS) {
    mirrorToField(bound, sliceFieldName(key), () => String(sliceFields?.[key] ?? ''))
  }

  type DoneData = {
    step?: string
    intent?: BlocksBulkIntent
    counts?: { requested?: number; changed?: number; unchanged?: number; rejected?: number }
  }
  const resultData = $derived(bound.state.result?.data as DoneData | undefined)
  const done = $derived(resultData?.step === 'done')
  const counts = $derived(resultData?.counts ?? null)
  const doneIntent = $derived<BlocksBulkIntent>(resultData?.intent === 'delete' ? 'delete' : 'lift')

  let lastHandledSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    if ((r.data as { step?: string } | undefined)?.step !== 'done') return
    lastHandledSubmission = r.submissionId
    void invalidatePaginator(BLOCKS_NAME)
    onDone?.()
  })
</script>

{#if done}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)}
    data-testid="blocks-bulk-done"
  >
    <h2 class="text-lg font-semibold leading-tight tracking-tight">
      {doneIntent === 'delete' ? 'Записи помечены удалёнными' : 'Блокировки сняты'}
    </h2>
    <p class="text-sm text-muted-foreground">
      {#if counts}
        Запрошено: {counts.requested ?? 0}, изменено: {counts.changed ?? 0}, без изменений:
        {counts.unchanged ?? 0}, отклонено: {counts.rejected ?? 0}.
      {:else}
        Набор обработан.
      {/if}
      {doneIntent === 'delete'
        ? 'Строки истории остаются: окончательное стирание — отдельное действие строки.'
        : 'Записи остались в истории со сроком снятия.'}
    </p>
    {#if doneHref}
      <a {...asLink(doneHref)} class="self-start text-sm underline">К блокировкам</a>
    {/if}
  </div>
{:else if !initial}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3', className)}
    aria-busy="true"
    data-testid="blocks-bulk-pending"
  >
    <p class="text-sm text-muted-foreground">Загружаем набор…</p>
  </div>
{:else if !initial.canLift && !initial.canDelete}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)}
    data-testid="blocks-bulk-forbidden"
  >
    <p class="text-sm text-muted-foreground">
      Снимать и удалять блокировки может круг записи: модератор или администратор.
    </p>
    <a {...asLink(doneHref ?? blocksListRoute.href())} class="self-start text-sm underline">
      К блокировкам
    </a>
  </div>
{:else if initial.tooMany}
  <p class={cn('text-sm text-destructive', className)} data-testid="blocks-bulk-too-many">
    Записей в наборе больше предела. Сократите выбор — набор не усекается молча.
  </p>
{:else}
  <Form
    id="user-blocks-bulk"
    form={bound}
    hiddenFields={bound.hidden()}
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-4 text-left', className)}
    data-testid="blocks-bulk-form"
  >
    <Common errors={bound.common} title="Не получилось выполнить действие" />

    <div hidden aria-hidden="true">
      <Field of={bound.f.ids} />
      {#each BLOCKS_SLICE_KEYS as key (key)}
        <Field of={bound.f[sliceFieldName(key) as keyof typeof bound.f]} />
      {/each}
    </div>

    <div class="flex flex-col gap-3">
      <h2
        class="text-lg font-semibold leading-tight tracking-tight"
        data-testid="blocks-bulk-title"
      >
        {initial.canLift ? lift.title : remove.title}
      </h2>
      <p class="text-sm text-muted-foreground" data-testid="blocks-bulk-detail">
        {initial.canLift ? lift.detail : remove.detail}
      </p>

      <div class="flex flex-wrap items-start gap-2">
        {#if initial.canLift}
          {#if lift.hold}
            <HoldButton
              type="submit"
              name="intent"
              value="lift"
              seconds={holdSeconds}
              when="fill"
              hover
              data-testid="blocks-bulk-lift-hold"
            >
              {lift.submit}
            </HoldButton>
          {:else}
            <button
              type="submit"
              name="intent"
              value="lift"
              class="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              data-testid="blocks-bulk-lift"
            >
              {lift.submit}
            </button>
          {/if}
        {/if}

        {#if initial.canDelete}
          {#if remove.hold}
            <HoldButton
              type="submit"
              name="intent"
              value="delete"
              variant="destructive"
              seconds={holdSeconds}
              when="fill"
              hover
              data-testid="blocks-bulk-delete-hold"
            >
              {remove.submit}
            </HoldButton>
          {:else}
            <button
              type="submit"
              name="intent"
              value="delete"
              class="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              data-testid="blocks-bulk-delete"
            >
              {remove.submit}
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </Form>
{/if}
