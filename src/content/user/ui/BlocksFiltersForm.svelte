<script lang="ts">
  /**
   * Форма фильтров списка блокировок — одна на sidebar, модалку и
   * `/blocks/filters`. С JS — `onApply` → `setExtra`. Без JS — POST и 303
   * на адрес, который собрал адаптер из `from`.
   */
  import { onMount, untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { Form } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import { Button } from '#components/ui/index.js'
  import { asLink, useModalLink } from '#hooks/links/index.js'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { BLOCK_SCOPES } from '../spec-block.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource } from '../schema.js'
  import { vault } from '../vault.svelte.js'
  import { mirrorToField } from './field-mirror.svelte.js'
  import { USER_PICKER_CHANNEL_PREFIX, type UserPickerPayload } from './UserPicker.svelte'
  import {
    applyBlocksFilters,
    blocksFiltersForm,
    scopeFieldName,
    type BlocksFilterValues as BlocksFilterValuesType,
  } from './blocks-list/filters-form.js'

  export type BlocksFilterValues = BlocksFilterValuesType

  interface Props {
    uid?: string | null
    canSeeDeleted: boolean
    canSeeLive?: boolean
    canPickUsers?: boolean
    initial: BlocksFilterValues
    selfHref?: string
    from?: string
    resetHref?: string
    onUidsChange?: (uids: string[]) => void
    onApply?: (patch: Record<string, string | undefined>, pageSize: number) => void | Promise<void>
    onReset?: () => void | Promise<void>
  }

  let {
    uid = null,
    canSeeDeleted,
    canSeeLive = true,
    canPickUsers = false,
    initial,
    selfHref = '/blocks/filters',
    from = '',
    resetHref,
    onUidsChange,
    onApply,
    onReset,
  }: Props = $props()

  const asModalLink = useModalLink()
  const modalsCtx = tryUseModals()
  const init = untrack(() => initial)
  const scopeEntries = Object.entries(BLOCK_SCOPES)
  const initScopeSet = new Set<string>(init.scopes)

  const bound = bindComponentForm(forms, blocksFiltersForm)
  const failed = untrack(() => Boolean(bound.state.result && !bound.state.result.ok))

  mirrorToField(bound, 'show_deleted', () => canSeeDeleted)
  mirrorToField(bound, 'show_live', () => canSeeLive)
  mirrorToField(bound, 'from', () => from)
  if (!failed) {
    mirrorToField(bound, 'ord', () => init.ord)
    mirrorToField(bound, 'size', () => init.size)
    mirrorToField(bound, 'state', () => init.state || (!canSeeLive && canSeeDeleted ? 'deleted' : 'all'))
    if (!untrack(() => uid)) mirrorToField(bound, 'uids', () => init.uids.join(','))
    for (const [scopeKey] of scopeEntries) {
      if (initScopeSet.has(scopeKey)) mirrorToField(bound, scopeFieldName(scopeKey), () => true)
    }
  }

  let pickedUids = $state<string[]>([...init.uids.filter(Boolean)])
  let lastPickerSeq = 0
  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  $effect(() => {
    if (onApply) return
    pickedUids = [...initial.uids.filter(Boolean)]
  })

  mirrorToField(bound, 'uids', () => (uid ? '' : pickedUids.join(',')))

  $effect(() => {
    const raw = modalsCtx?.view.sharedData[`${USER_PICKER_CHANNEL_PREFIX}blocks.uids`] as
      | UserPickerPayload
      | undefined
    if (!raw || raw.seq <= lastPickerSeq) return
    lastPickerSeq = raw.seq
    const next = [...raw.ids.filter(Boolean)]
    pickedUids = next
    onUidsChange?.(next)
  })

  const pickUsersGrant = useGrants(grants(authResource).select)
  const effectiveCanPickUsers = $derived(
    !uid && (vault.principal !== null ? pickUsersGrant.current : canPickUsers),
  )
  const pickerDisabled = $derived(Boolean(uid) || !effectiveCanPickUsers)

  const pickerHref = $derived.by(() => {
    const q = new URLSearchParams({
      mode: 'multiple',
      param: 'blocks.uids',
      from: selfHref,
    })
    if (pickedUids.length) q.set('picked', pickedUids.join(','))
    return `/users/pick?${q.toString()}`
  })

  const clearUsersHref = $derived.by(() => {
    const u = new URL(selfHref, 'http://local.invalid')
    u.searchParams.set('blocks.uids', '')
    const qs = u.searchParams.toString()
    return qs ? `${u.pathname}?${qs}` : u.pathname
  })

  let formError = $state('')

  function submit(e: SubmitEvent) {
    if (!hydrated || !onApply) return
    e.preventDefault()
    const applied = applyBlocksFilters(bound.values, {
      canSeeDeleted,
      canSeeLive,
      canPickUsers: effectiveCanPickUsers,
      uid,
    })
    if (!applied.ok) {
      formError = applied.message
      return
    }
    formError = ''
    void onApply(applied.patch, applied.pageSize)
  }
</script>

<Form
  form={bound}
  onsubmit={submit}
  hiddenFields={bound.hidden()}
  class="flex flex-col gap-4"
  data-testid="blocks-filters-form"
>
  <div hidden aria-hidden="true">
    <Field of={bound.field('paginator')!} />
    <Field of={bound.field('page_param')!} />
    <Field of={bound.field('from')!} />
    <Field of={bound.field('show_deleted')!} />
    <Field of={bound.field('show_live')!} />
    <Field of={bound.field('uids')!} />
  </div>

  <Common errors={bound.common} />

  <div class="flex flex-wrap gap-3">
    <div class="min-w-0 flex-1 basis-44">
      <Field of={bound.field('ord')!} />
    </div>
    <div class="min-w-0 flex-1 basis-44">
      <Field of={bound.field('size')!} />
    </div>
  </div>

  <Field of={bound.field('state')!} />

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium">Сферы блокировок</span>
    <div class="flex flex-col gap-1.5">
      {#each scopeEntries as [scopeKey] (scopeKey)}
        <Field of={bound.field(scopeFieldName(scopeKey))!} />
      {/each}
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium">Пользователи</span>
    <div class="flex flex-wrap items-center gap-2">
      {#if pickerDisabled}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          data-testid="blocks-filters-pick-users"
        >
          Выбрать пользователей
        </Button>
      {:else}
        <Button
          {...asModalLink(
            'user.picker',
            { mode: 'multiple', channel: 'blocks.uids', picked: pickedUids.join(',') },
            { href: pickerHref },
          )}
          variant="outline"
          size="sm"
          data-testid="blocks-filters-pick-users"
        >
          Выбрать пользователей{#if pickedUids.length}&nbsp;({pickedUids.length}){/if}
        </Button>
        {#if pickedUids.length > 0}
          {#if onApply}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => {
                pickedUids = []
                onUidsChange?.([])
              }}
              data-testid="blocks-filters-clear-users"
            >
              Сбросить пользователей
            </Button>
          {:else}
            <Button
              {...asLink(clearUsersHref, { replace: true })}
              variant="ghost"
              size="sm"
              data-testid="blocks-filters-clear-users"
            >
              Сбросить пользователей
            </Button>
          {/if}
        {/if}
      {/if}
    </div>
    {#if uid}
      <p class="text-xs text-muted-foreground" data-testid="blocks-filters-uid-locked-hint">
        Фильтр по пользователям недоступен: список открыт для конкретного пользователя.
      </p>
    {:else if !effectiveCanPickUsers}
      <p class="text-xs text-muted-foreground">
        Выбор пользователей доступен только при наличии права чтения аккаунтов.
      </p>
    {/if}
  </div>

  {#if formError}
    <p class="text-sm text-destructive" role="alert">{formError}</p>
  {/if}

  <div class="flex flex-wrap items-center justify-end gap-2 pt-2">
    {#if onReset}
      <Button type="button" variant="ghost" onclick={() => onReset()}>
        Сбросить
      </Button>
    {:else if resetHref}
      <Button {...asLink(resetHref)} variant="ghost">
        Сбросить
      </Button>
    {/if}
    <Button type="submit" data-testid="blocks-filters-apply">Применить</Button>
  </div>
</Form>
