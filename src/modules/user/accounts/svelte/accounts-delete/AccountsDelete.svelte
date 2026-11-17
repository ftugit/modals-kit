<script lang="ts">
  /**
   * Единица удаления аккаунтов (`user.accounts.delete`): подтверждение набора
   * `ids` или среза списка seed-юзеров.
   *
   * Правило успеха (§6.1): результат остаётся в носителе — адрес не меняется,
   * слой сам не закрывается. Переход объявлен только в регистрации формы и
   * случается лишь без JS.
   *
   * Слова исхода: «удаление запрошено», а не «стёрто» — мягкую метку ставит
   * домен, зачистку выполняет планировщик владельца (крон вне плана).
   */
  import { untrack } from 'svelte'
  import { Form } from '#core/lib/form/svelte/index.js'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import Field from '#core/ui/form/Field.svelte'
  import Common from '#core/ui/form/Common.svelte'
  import HoldButton from '#core/ui/button/HoldButton.svelte'
  import { asLink } from '#core/hooks/links/index.js'
  import { cn } from '#core/ui/utils.js'
  import { invalidatePaginator } from '#core/lib/paginate/index.js'
  import { userListRoute } from '#modules/user/base/routes.js'
  import type { AccountsDeleteRouteData } from '#modules/user/base/model/types.js'
  import { userSession } from '#modules/user/base/svelte/vault.svelte.js'
  import { mirrorToField } from '#modules/user/base/svelte/field-mirror.svelte.js'
  import { SEED_USERS_NAME } from '#modules/user/accounts/svelte/seed-users/source.js'
  import {
    ACCOUNTS_SLICE_KEYS,
    accountsDeleteForm,
    accountsDeleteSummary,
    sliceFieldName,
  } from './form.js'

  interface Props {
    /** Явный набор: отмеченные строки списка. */
    ids?: readonly string[]
    /** Непустой срез: значения фильтров, которые принёс носитель. */
    sliceFields?: Readonly<Record<string, string>> | null
    initial?: AccountsDeleteRouteData | null
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
  const summary = $derived(accountsDeleteSummary({ count, slice }))
  const holdSeconds = $derived(initial?.holdSeconds ?? 2)

  const bound = bindComponentForm(forms, accountsDeleteForm(), {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  mirrorToField(bound, 'ids', () => ids.join(','))
  for (const key of ACCOUNTS_SLICE_KEYS) {
    mirrorToField(bound, sliceFieldName(key), () => String(sliceFields?.[key] ?? ''))
  }

  type DoneCounts = {
    requested?: number
    changed?: number
    unchanged?: number
    rejected?: number
  }
  const resultData = $derived(
    bound.state.result?.data as { step?: string; counts?: DoneCounts } | undefined,
  )
  const done = $derived(resultData?.step === 'done')
  const counts = $derived(resultData?.counts ?? null)

  let lastHandledSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandledSubmission) return
    if ((r.data as { step?: string } | undefined)?.step !== 'done') return
    lastHandledSubmission = r.submissionId
    void invalidatePaginator(SEED_USERS_NAME)
    onDone?.()
  })
</script>

{#if done}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)}
    data-testid="accounts-delete-done"
  >
    <h2 class="text-lg font-semibold leading-tight tracking-tight">Удаление запрошено</h2>
    <p class="text-sm text-muted-foreground">
      {#if counts}
        Запрошено: {counts.requested ?? 0}, изменено: {counts.changed ?? 0}, без изменений:
        {counts.unchanged ?? 0}, отклонено: {counts.rejected ?? 0}.
      {:else}
        Набор обработан.
      {/if}
      Строки данных останутся до зачистки планировщиком.
    </p>
    {#if doneHref}
      <a {...asLink(doneHref)} class="self-start text-sm underline">К аккаунтам</a>
    {/if}
  </div>
{:else if !initial}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3', className)}
    aria-busy="true"
    data-testid="accounts-delete-pending"
  >
    <p class="text-sm text-muted-foreground">Загружаем набор…</p>
  </div>
{:else if !initial.canDelete}
  <div
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)}
    data-testid="accounts-delete-forbidden"
  >
    <p class="text-sm text-muted-foreground">
      Удалять чужие аккаунты может только администратор.
    </p>
    <a {...asLink(doneHref ?? userListRoute.href())} class="self-start text-sm underline">
      К аккаунтам
    </a>
  </div>
{:else if initial.tooMany}
  <p class={cn('text-sm text-destructive', className)} data-testid="accounts-delete-too-many">
    Аккаунтов в наборе больше предела. Сократите выбор — набор не усекается молча.
  </p>
{:else}
  <Form
    id="user-accounts-delete"
    form={bound}
    hiddenFields={bound.hidden()}
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-4 text-left', className)}
    data-testid="accounts-delete-form"
  >
    <Common errors={bound.common} title="Не получилось запросить удаление" />

    <div hidden aria-hidden="true">
      <Field of={bound.f.ids} />
      {#each ACCOUNTS_SLICE_KEYS as key (key)}
        <Field of={bound.f[sliceFieldName(key) as keyof typeof bound.f]} />
      {/each}
    </div>

    <div class="flex flex-col gap-3">
      <h2
        class="text-lg font-semibold leading-tight tracking-tight"
        data-testid="accounts-delete-title"
      >
        {summary.title}
      </h2>
      <p class="text-sm text-muted-foreground" data-testid="accounts-delete-detail">
        {summary.detail}
      </p>

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
          data-testid="accounts-delete-hold"
        >
          {summary.submit}
        </HoldButton>
      {:else}
        <button
          type="submit"
          name="intent"
          value="delete"
          class="self-start rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          data-testid="accounts-delete-submit"
        >
          {summary.submit}
        </button>
      {/if}
    </div>
  </Form>
{/if}
