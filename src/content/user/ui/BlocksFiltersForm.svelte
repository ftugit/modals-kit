<script lang="ts">
  /**
   * Форма фильтров списка блокировок (`user.blocks.filters` и страница-fallback
   * `/blocks/filters`):
   *  - порядок сортировки и размер порции (30..100);
   *  - состояние (`all`, `active`, `expired`, при `canSeeDeleted` — `deleted`;
   *    у чистого аудитора без `canSeeLive` — только `deleted`);
   *  - выбор ключей сфер `BLOCK_SCOPES`;
   *  - кнопка открытия пикера пользователей `user.picker` (`multiple`), которая
   *    ОТКЛЮЧЕНА при переданном `uid` в `BlocksList` (или при отсутствии `canPickUsers`).
   */
  import { untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { defineForm, field, v } from '#lib/form/index.js'
  import { bind, createConfig, Form } from '#lib/form/svelte/index.js'
  import { ru } from '#components/form/messages.ru.js'
  import Field from '#components/form/Field.svelte'
  import { Button } from '#components/ui/index.js'
  import { asLink, useModalLink } from '#hooks/links/index.js'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource } from '../schema.js'
  import { BLOCK_SCOPES, isBlockScope } from '../spec-block.js'
  import { vault } from '../vault.svelte.js'
  import { mirrorToField } from './field-mirror.svelte.js'
  import { USER_PICKER_CHANNEL_PREFIX, type UserPickerPayload } from './UserPicker.svelte'

  export interface BlocksFilterValues {
    ord: string
    state: string
    scopes: string[]
    uids: string[]
    size: number
  }

  interface Props {
    /** Фиксированный пользователь `BlocksList`: если передан, выбор пользователей в фильтре отключён. */
    uid?: string | null
    canSeeDeleted: boolean
    canSeeLive?: boolean
    canPickUsers?: boolean
    initial: BlocksFilterValues
    /** Текущий адрес экрана фильтров (для возврата из no-JS `/users/pick`). */
    selfHref?: string
    action?: string
    hiddenFields?: readonly { name: string; value: string }[]
    resetHref?: string
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
    action,
    hiddenFields = [],
    resetHref,
    onApply,
    onReset,
  }: Props = $props()

  const asModalLink = useModalLink()
  const modalsCtx = tryUseModals()

  const init = untrack(() => initial)
  const scopeEntries = Object.entries(BLOCK_SCOPES)
  const initScopeSet = new Set<string>(init.scopes.filter(isBlockScope))

  const scopeFields: Record<string, ReturnType<typeof field.checkbox>> = {}
  for (const [scopeKey, scopeInfo] of scopeEntries) {
    scopeFields[`blocks.sc.${scopeKey}`] = field.checkbox({
      label: `${scopeInfo.title} (${scopeKey})`,
      defaultValue: initScopeSet.has(scopeKey),
    })
  }

  const defaultState = untrack(() => (!canSeeLive && canSeeDeleted ? 'deleted' : init.state || 'all'))

  const desc = defineForm({
    id: 'user-blocks-filters',
    fields: {
      'blocks.size': field.number({
        label: 'Элементов на страницу',
        defaultValue: init.size || 30,
        validate: [v.required(), v.integer(), v.minValue(30), v.maxValue(100)],
      }),
      'blocks.ord': field.select({
        label: 'Порядок',
        options: [
          { value: 'created-desc', label: 'Сначала новые (по созданию)' },
          { value: 'created-asc', label: 'Сначала старые (по созданию)' },
          { value: 'until-asc', label: 'По сроку окончания (по возрастанию)' },
          { value: 'until-desc', label: 'По сроку окончания (по убыванию)' },
          { value: 'scope-asc', label: 'По сфере (А→Я)' },
          { value: 'scope-desc', label: 'По сфере (Я→А)' },
          ...(untrack(() => canSeeDeleted)
            ? [
                { value: 'deleted-desc', label: 'Недавно удалённые' },
                { value: 'deleted-asc', label: 'Давно удалённые' },
              ]
            : []),
        ],
        defaultValue: init.ord || 'created-desc',
      }),
      'blocks.state': field.select({
        label: 'Состояние',
        options: [
          ...(untrack(() => canSeeLive)
            ? [
                { value: 'all', label: 'Все живые (активные и снятые)' },
                { value: 'active', label: 'Только активные' },
                { value: 'expired', label: 'Только снятые / истёкшие' },
              ]
            : []),
          ...(untrack(() => canSeeDeleted)
            ? [{ value: 'deleted', label: 'Только мягко удалённые' }]
            : []),
        ],
        defaultValue: defaultState,
      }),
      'blocks.uids': field.hidden({
        defaultValue: init.uids.join(','),
      }),
      ...scopeFields,
    },
  })

  const config = createConfig({ resolve: () => undefined, messages: ru })
  const bound = bind(config, desc)

  let pickedUids = $state<string[]>([...init.uids.filter(Boolean)])
  let lastPickerSeq = 0

  mirrorToField(bound, 'blocks.uids', () => (uid ? '' : pickedUids.join(',')))

  $effect(() => {
    const raw = modalsCtx?.view.sharedData[`${USER_PICKER_CHANNEL_PREFIX}blocks.uids`] as
      | UserPickerPayload
      | undefined
    if (!raw || raw.seq <= lastPickerSeq) return
    lastPickerSeq = raw.seq
    pickedUids = [...raw.ids.filter(Boolean)]
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

  let formError = $state('')
  const clean = (val: unknown): string => (typeof val === 'string' ? val.trim() : '')

  function submit(e: SubmitEvent) {
    const vals = bound.values as Record<string, unknown>
    const sizeRaw = vals['blocks.size']
    const pageSize = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw)
    if (!Number.isInteger(pageSize) || pageSize < 30 || pageSize > 100) {
      e.preventDefault()
      formError = 'Элементов на страницу — целое число от 30 до 100'
      return
    }
    formError = ''
    if (!onApply) return
    e.preventDefault()

    const chosenScopes: string[] = []
    for (const [scopeKey] of scopeEntries) {
      if (vals[`blocks.sc.${scopeKey}`] === true) chosenScopes.push(scopeKey)
    }

    const ord = clean(vals['blocks.ord'])
    const state = clean(vals['blocks.state'])
    const uidsCsv = uid ? '' : pickedUids.filter(Boolean).join(',')

    void onApply(
      {
        ord: ord === 'created-desc' ? undefined : ord || undefined,
        state: state === 'all' ? undefined : state || undefined,
        scopes: chosenScopes.length ? chosenScopes.join(',') : undefined,
        uids: uidsCsv || undefined,
      },
      pageSize,
    )
  }
</script>

<Form
  form={bound}
  onsubmit={submit}
  action={action}
  method={action ? 'get' : undefined}
  {hiddenFields}
  class="space-y-4"
  data-testid="blocks-filters-form"
>
  <div hidden aria-hidden="true">
    <Field of={bound.field('blocks.uids')} />
  </div>

  <div class="flex flex-wrap gap-3">
    <div class="min-w-0 flex-1 basis-44">
      <Field of={bound.field('blocks.ord')} />
    </div>
    <div class="min-w-0 flex-1 basis-44">
      <Field of={bound.field('blocks.size')} />
    </div>
  </div>

  <Field of={bound.field('blocks.state')} />

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium">Сферы блокировок</span>
    <div class="flex flex-col gap-1.5">
      {#each scopeEntries as [scopeKey] (scopeKey)}
        <Field of={bound.field(`blocks.sc.${scopeKey}`)} />
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onclick={() => (pickedUids = [])}
            data-testid="blocks-filters-clear-users"
          >
            Сбросить пользователей
          </Button>
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
