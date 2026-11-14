<script lang="ts">
  /**
   * Единица закрытия устройств (`user.session.delete`): один компонент на оба
   * адреса и на два варианта — «закрыть» и «выйти здесь» (вариант приходит
   * пропом, собственной разметки у выхода нет).
   *
   * Правило успеха (§6.1): результат остаётся в носителе — адрес не меняется,
   * слой не закрывается сам. Переход объявлен только в регистрации формы и
   * случается лишь без JS.
   */
  import { untrack } from 'svelte'
  import { Form } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { Button, Skeleton } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { invalidatePaginator } from '#lib/paginate/index.js'
  import type { SessionDeleteRouteData } from '../../types.js'
  import type { SessionDeleteVariant } from '../../session-delete.js'
  import { userSession } from '../../vault.svelte.js'
  import { SESSIONS_NAME } from '../sessions-list/source.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { sessionDeleteForm, sessionDeleteSummary, sliceFieldName } from './form.js'
  import { SESSIONS_FILTER_KEYS } from '../sessions-list/source.js'

  interface Props {
    /** Явный набор: одна строка карточки или отмеченные строки списка. */
    ids?: readonly string[]
    /** Срез списка: значения фильтров, которые принёс носитель. */
    sliceFields?: Readonly<Record<string, string>> | null
    variant?: SessionDeleteVariant
    initial?: SessionDeleteRouteData | null
    action?: string
    form?: { result?: Result } | null
    doneHref?: string
    onDone?: () => void
    class?: string
  }

  let {
    ids = [],
    sliceFields = null,
    variant = 'delete',
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
  const count = $derived(ids.length)
  const summary = $derived(sessionDeleteSummary({ count, slice, variant }))
  const holdSeconds = $derived(initial?.holdSeconds ?? 2)

  const bound = bindComponentForm(forms, sessionDeleteForm(), {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  mirrorToField(bound, 'ids', () => ids.join(','))
  mirrorToField(bound, 'variant', () => variant)
  for (const key of SESSIONS_FILTER_KEYS) {
    mirrorToField(bound, sliceFieldName(key), () => String(sliceFields?.[key] ?? ''))
  }

  let lastHandledSubmission = ''
  const resultData = $derived(
    bound.state.result?.data as { step?: string; revoked?: number | null } | undefined,
  )
  const done = $derived(resultData?.step === 'done')

  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    if ((r.data as { step?: string } | undefined)?.step !== 'done') return
    lastHandledSubmission = r.submissionId
    void invalidatePaginator(SESSIONS_NAME)
    onDone?.()
  })
</script>

{#if done}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)}
    data-testid="session-delete-done"
  >
    <h2 class="text-lg font-semibold leading-tight tracking-tight">
      {variant === 'logout' ? 'Вы вышли' : 'Устройства закрыты'}
    </h2>
    <p class="text-sm text-muted-foreground">
      {#if typeof resultData?.revoked === 'number'}
        Закрыто устройств: {resultData.revoked}.
      {:else}
        Набор закрыт по фильтру списка на момент отправки.
      {/if}
    </p>
    {#if doneHref}
      <Button href={doneHref} variant="outline" class="self-start">К устройствам</Button>
    {/if}
  </div>
{:else if !initial}
  <div class={cn('mx-auto flex w-full max-w-sm flex-col gap-3', className)} aria-busy="true" data-testid="session-delete-pending">
    <Skeleton class="h-5 w-44" />
    <Skeleton class="h-14 w-full" />
    <Skeleton class="h-9 w-48" />
  </div>
{:else if initial.tooMany}
  <p class={cn('text-sm text-destructive', className)} data-testid="session-delete-too-many">
    Устройств в наборе больше предела ({initial.ids.length}). Сократите выбор — набор не усекается молча.
  </p>
{:else}
  <Form
    id="user-session-delete"
    form={bound}
    hiddenFields={bound.hidden()}
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-4 text-left', className)}
    data-testid="session-delete-form"
  >
    <Common errors={bound.common} title="Не получилось закрыть устройства" />

    <div hidden aria-hidden="true">
      <Field of={bound.f.ids} />
      <Field of={bound.f.variant} />
      {#each SESSIONS_FILTER_KEYS as key (key)}
        <Field of={bound.f[sliceFieldName(key) as keyof typeof bound.f]} />
      {/each}
    </div>

    <div class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold leading-tight tracking-tight" data-testid="session-delete-title">
        {summary.title}
      </h2>
      <p class="text-sm text-muted-foreground" data-testid="session-delete-detail">{summary.detail}</p>

      {#if summary.hold}
        <HoldButton
          type="submit"
          name="intent"
          value="delete"
          variant="destructive"
          seconds={holdSeconds}
          when="fill"
          hover
          class="self-start"
          data-testid="session-delete-hold"
        >
          Удерживайте, чтобы закрыть
        </HoldButton>
      {:else}
        <Button type="submit" name="intent" value="delete" variant="destructive" class="self-start" data-testid="session-delete-submit">
          {variant === 'logout' ? 'Выйти' : 'Закрыть'}
        </Button>
      {/if}
    </div>
  </Form>
{/if}
