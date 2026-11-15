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
  import { asLink } from '#hooks/links/index.js'
  import { goto } from '$app/navigation'
  import { cn } from '#components/utils.js'
  import { invalidatePaginator } from '#lib/paginate/index.js'
  import { SESSIONS_NAME } from '../sessions-list/source.js'
  import type { SessionDeleteRouteData } from '../../types.js'
  import { SESSION_DELETE_SLICE_KEYS, type SessionDeleteVariant } from '../../session-delete.js'
  import { userSession, vault } from '../../vault.svelte.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { sessionDeleteForm, sessionDeleteSummary, sliceFieldName } from './form.js'
  import { logoutLocalForm } from '../logout/form.js'

  interface Props {
    /** Явный набор: одна строка карточки или отмеченные строки списка. */
    ids?: readonly string[]
    /** Срез списка: значения фильтров, которые принёс носитель. */
    sliceFields?: Readonly<Record<string, string>> | null
    variant?: SessionDeleteVariant
    initial?: SessionDeleteRouteData | null
    action?: string
    localAction?: string
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
    localAction,
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

  const bound = bindComponentForm(forms, sessionDeleteForm({ variant: untrack(() => variant) }), {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  // Локальный выход (только logout): куки снимаются, сессия живёт.
  const localBound =
    untrack(() => variant) === 'logout'
      ? bindComponentForm(forms, logoutLocalForm, {
          action: untrack(() => localAction) ?? '/user/logout?/local',
          session: userSession,
        })
      : null

  mirrorToField(bound, 'ids', () => ids.join(','))
  mirrorToField(bound, 'variant', () => variant)
  for (const key of SESSION_DELETE_SLICE_KEYS) {
    mirrorToField(bound, sliceFieldName(key), () => String(sliceFields?.[key] ?? ''))
  }

  let lastHandledSubmission = ''
  const resultData = $derived(
    bound.state.result?.data as { step?: string; revoked?: number | null } | undefined,
  )
  const done = $derived(resultData?.step === 'done')
  // Неизвестный исход: форма вернула ошибку (в т.ч. retryable) — куки
  // сохраняются, показываем повтор и «выйти только здесь» (только logout).
  const failed = $derived(
    bound.state.result?.outcome === 'unknown' ||
      Boolean(bound.state.result && !bound.state.result.ok && !done),
  )
  let retriedSubmission = $state('')
  const unknown = $derived(
    variant === 'logout' &&
      failed &&
      bound.state.result?.submissionId !== retriedSubmission,
  )

  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    if ((r.data as { step?: string } | undefined)?.step !== 'done') return
    lastHandledSubmission = r.submissionId
    void invalidatePaginator(SESSIONS_NAME)
    // Выход: снимаем куки и память браузера (сценарий успеха). Экрана
    // «Вы вышли» нет — сразу уходим на главную страницу приложения.
    if (variant === 'logout') {
      vault.clear()
      onDone?.()
      if (doneHref) void goto(doneHref, { invalidateAll: true }) // session-delete-ok: явный выход уводит на главную
      return
    }
    onDone?.()
  })

  // Локальный выход: куки снял сервер, хранилище чистит клиент.
  $effect(() => {
    if (!localBound) return
    const r = localBound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    lastHandledSubmission = r.submissionId
    vault.clear()
  })
</script>

{#if done && variant !== 'logout'}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)}
    data-testid="session-delete-done"
  >
    <h2 class="text-lg font-semibold leading-tight tracking-tight">
      Устройства закрыты
    </h2>
    <p class="text-sm text-muted-foreground">
      {#if typeof resultData?.revoked === 'number'}
        Закрыто устройств: {resultData.revoked}.
      {:else}
        Набор закрыт по фильтру списка на момент отправки.
      {/if}
    </p>
    {#if doneHref}
      <a {...asLink(doneHref)} class="self-start text-sm underline">К устройствам</a>
    {/if}
  </div>
{:else if !initial}
  <div class={cn('mx-auto flex w-full max-w-sm flex-col gap-3', className)} aria-busy="true" data-testid="session-delete-pending">
    <p class="text-sm text-muted-foreground">Загружаем набор…</p>
  </div>
{:else if initial.tooMany}
  <p class={cn('text-sm text-destructive', className)} data-testid="session-delete-too-many">
    Устройств в наборе больше предела ({initial.ids.length}). Сократите выбор — набор не усекается молча.
  </p>
{:else if initial && !initial.enabled}
  <div class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)} data-testid="session-delete-no-read">
    <p class="text-sm text-muted-foreground">Сессию прочитать не удалось — доступен только выход на этом устройстве.</p>
    {#if localBound}
      <Form
        id="user-logout-local"
        form={localBound}
        hiddenFields={localBound.hidden()}
        class="inline-flex"
      >
        <button
          type="submit"
          name="intent"
          value="local"
          class="self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          data-testid="session-delete-local"
        >
          Выйти только здесь
        </button>
      </Form>
    {/if}
  </div>
{:else if unknown}
  <div class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)} data-testid="session-delete-unknown">
    <h2 class="text-lg font-semibold leading-tight tracking-tight">Исход неизвестен</h2>
    <p class="text-sm text-muted-foreground">Повторите попытку или выйдите только на этом устройстве.</p>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
        data-testid="session-delete-retry"
        onclick={() => (retriedSubmission = bound.state.result?.submissionId ?? '')}
      >
        Повторить
      </button>
      {#if localBound}
        <Form
          id="user-logout-local"
          form={localBound}
          hiddenFields={localBound.hidden()}
          class="inline-flex"
        >
          <button
            type="submit"
            name="intent"
            value="local"
            class="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            data-testid="session-delete-exit-here"
          >
            Выйти только здесь
          </button>
        </Form>
      {/if}
    </div>
  </div>
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
      {#each SESSION_DELETE_SLICE_KEYS as key (key)}
        <Field of={bound.f[sliceFieldName(key) as keyof typeof bound.f]} />
      {/each}
    </div>

    <div class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold leading-tight tracking-tight" data-testid="session-delete-title">
        {summary.title}
      </h2>
      <p class="text-sm text-muted-foreground" data-testid="session-delete-detail">{summary.detail}</p>

      {#if variant === 'logout'}
        <Field of={bound.f.include_current} />
      {/if}

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
        <button
          type="submit"
          name="intent"
          value="delete"
          class="self-start rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          data-testid="session-delete-submit"
        >
          {variant === 'logout' ? 'Выйти' : 'Закрыть'}
        </button>
      {/if}

    </div>
  </Form>
{/if}
