<script lang="ts">
  /**
   * Компонент удаления записи блокировки (`user.block`): подтверждение
   * удержанием кнопки (`HoldButton`) + условный чекбокс полного удаления
   * (`hard`), который отображается ТОЛЬКО при наличии у вызывающего права
   * `canHardDelete` (если запись ещё не помечена удалённой).
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { Button, Skeleton } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import type { AuthErrorCode } from '../../error.js'
  import { describeBlockScope } from '../../spec-block.js'
  import type { BlockDeleteRouteData } from '../../types.js'
  import { userSession } from '../../vault.svelte.js'
  import { bumpBlocksRevision } from '../blocks-list/revision.svelte.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { blockDeleteForm } from './form.js'

  interface Props {
    blockId: string
    uid?: string | null
    initial?: BlockDeleteRouteData | null
    doneHref?: string
    action?: string
    form?: { result?: Result } | null
    onAcl?: (fact: AuthErrorCode) => void
    onDone?: () => void
    class?: string
  }

  let {
    blockId,
    uid = null,
    initial = null,
    doneHref,
    action,
    form,
    onAcl,
    onDone,
    class: className,
  }: Props = $props()

  const fixedUid = $derived(uid?.trim() || null)
  let routeData = $state<BlockDeleteRouteData | null>(untrack(() => initial))
  let askedUrl = ''
  const initialSnap = untrack(() => initial)

  $effect(() => {
    if (initial && initial === initialSnap) {
      routeData = initial
      return
    }
    const id = blockId.trim()
    if (!id) {
      onAcl?.('auth.identity-unknown')
      return
    }
    const url = fixedUid
      ? `/user/${encodeURIComponent(fixedUid)}/blocks/${encodeURIComponent(id)}/delete`
      : `/blocks/${encodeURIComponent(id)}/delete`
    if (askedUrl === url) return
    askedUrl = url
    void (async () => {
      const r = await preloadData(url)
      if (askedUrl !== url) return
      if (r.type !== 'loaded') {
        onAcl?.('auth.expired')
        return
      }
      const d = r.data as BlockDeleteRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      if (!d.detail?.canDelete) {
        onAcl?.('auth.forbidden')
        return
      }
      routeData = d
    })()
  })

  const bound = bindComponentForm(forms, blockDeleteForm, {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  mirrorToField(bound, 'block_id', () => blockId)
  mirrorToField(bound, 'subject', () => fixedUid ?? routeData?.detail?.block.authId ?? '')

  const detail = $derived(routeData?.detail ?? null)
  const holdSeconds = $derived(routeData?.holdSeconds ?? 2)
  const alreadyDeleted = $derived(detail?.block.deletedAt != null)
  const scopeInfo = $derived(detail ? describeBlockScope(detail.block.scope) : null)

  let lastHandledSubmission = ''
  const done = $derived(
    (bound.state.result?.data as { step?: string } | undefined)?.step === 'done',
  )

  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    const d = r.data as { step?: string } | undefined
    if (d?.step === 'done') {
      lastHandledSubmission = r.submissionId
      bumpBlocksRevision()
      onDone?.()
    }
  })
</script>

{#if done}
  <div class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)} data-testid="block-delete-done">
    <h2 class="text-base font-semibold">Запись блокировки удалена</h2>
    <p class="text-sm text-muted-foreground">
      Изменения применены к истории блокировок аккаунта.
    </p>
    {#if doneHref}
      <Button href={doneHref} variant="outline" class="self-start">К списку блокировок</Button>
    {/if}
  </div>
{:else if !detail}
  <div class={cn('mx-auto flex w-full max-w-sm flex-col gap-3', className)} aria-busy="true">
    <Skeleton class="h-5 w-44" />
    <Skeleton class="h-14 w-full" />
    <Skeleton class="h-9 w-48" />
  </div>
{:else}
  <Form
    id="user-block-delete"
    form={bound}
    hiddenFields={bound.hidden()}
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-4 text-left', className)}
    data-testid="block-delete-form"
  >
    <Common errors={bound.common} title="Не получилось удалить блокировку" />

    <div hidden aria-hidden="true">
      <Field of={bound.f.block_id} />
      <Field of={bound.f.subject} />
    </div>

    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Удаление блокировки</h2>
      <p class="text-sm text-muted-foreground">
        Сфера: <strong class="text-foreground">{scopeInfo?.title ?? detail.block.scope}</strong>
        — {detail.block.reason}
      </p>

      {#if alreadyDeleted}
        <p class="text-sm text-destructive" data-testid="block-delete-already-soft">
          Запись уже помечена удалённой. Подтверждение сотрёт её из базы данных окончательно.
        </p>
      {:else}
        <p class="text-sm text-muted-foreground">
          По умолчанию запись помечается удалённой и перестаёт действовать, но сохраняется для аудита.
        </p>
        {#if detail.canHardDelete}
          <div data-testid="block-delete-hard-option">
            <Field of={bound.f.hard} />
          </div>
        {/if}
      {/if}

      <HoldButton
        type="submit"
        name="intent"
        value="delete"
        variant="destructive"
        seconds={holdSeconds}
        when="fill"
        hover
        task={formTask(bound.state, 'delete')}
        class="self-start"
        data-testid="block-delete-submit"
      >
        Удерживайте, чтобы удалить
      </HoldButton>
    </div>
  </Form>
{/if}
