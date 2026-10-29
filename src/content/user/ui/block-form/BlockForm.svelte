<script lang="ts">
  /**
   * Единый компонент создания, редактирования и read-only просмотра записи
   * блокировки (`user.block`).
   *
   *  - В режиме `create` показывает доступные сферы `assignableScopes`, причину,
   *    срок (`forever` / `until`), а при открытии из глобального списка без `uid` —
   *    поле целевого `UUID` и кнопку выбора пользователя `user.picker` (`single`).
   *  - В режиме `edit` соблюдает полевые права модели (`scope` неизменяем;
   *    `reason` редактируем только кругу `block.edit`/`admin`; `until` — кругу
   *    записи). Для читателей без прав записи (`block.read`, владелец цели или
   *    мягко удалённая запись) карточка открывается без возможности отправки
   *    (`canSubmit = false`).
   *  - В глобальном режиме `edit` (без переданного `uid`) показывает disabled-поле
   *    с `id` целевого пользователя (вне `defineForm`, без `name` — в `FormData`
   *    не отправляется) и кнопку перехода в профиль `user.profile`.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import { Badge, Button, Input, Label, Skeleton, Textarea, TimeAgo } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import type { AuthErrorCode } from '../../error.js'
  import { describeBlockScope, isBlockScope, specBlocks } from '../../spec-block.js'
  import type { BlockCreateRouteData, BlockEditRouteData } from '../../types.js'
  import { userSession } from '../../vault.svelte.js'
  import { bumpBlocksRevision } from '../blocks-list/revision.svelte.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { USER_PICKER_CHANNEL_PREFIX, type UserPickerPayload } from '../UserPicker.svelte'
  import { createBlockFormDescription } from './form.js'

  interface Props {
    mode: 'create' | 'edit'
    /** Фиксированный `uid` из родительского `BlocksList` (пусто — глобальный список). */
    uid?: string | null
    /** Идентификатор записи блокировки (обязателен для `mode === 'edit'`). */
    blockId?: string | null
    /** Начальное значение `subject` в глобальном `create` (например, из no-JS `/users/pick`). */
    initialSubject?: string
    /** Данные `load` страницы создания (SSR/no-JS). */
    initialCreate?: BlockCreateRouteData | null
    /** Данные `load` страницы редактирования/просмотра (SSR/no-JS). */
    initialEdit?: BlockEditRouteData | null
    /** Текущий путь страницы для возврата из no-JS `/users/pick`. */
    selfHref?: string
    action?: string
    form?: { result?: Result } | null
    onAcl?: (fact: AuthErrorCode) => void
    onDone?: () => void
    class?: string
  }

  let {
    mode,
    uid = null,
    blockId = null,
    initialSubject = '',
    initialCreate = null,
    initialEdit = null,
    selfHref = '/blocks/new',
    action,
    form,
    onAcl,
    onDone,
    class: className,
  }: Props = $props()

  const asModalLink = useModalLink()
  const modalsCtx = tryUseModals()

  const fixedUid = $derived(uid?.trim() || null)
  const targetBlockId = $derived(blockId?.trim() || null)

  let createData = $state<BlockCreateRouteData | null>(untrack(() => initialCreate))
  let editData = $state<BlockEditRouteData | null>(untrack(() => initialEdit))
  let askedKey = ''
  const initialRevSnapshot = untrack(() => ({ c: initialCreate, e: initialEdit }))

  function toDatetimeLocal(ms: number): string {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  $effect(() => {
    if (mode === 'create') {
      if (initialCreate && initialCreate === initialRevSnapshot.c) {
        createData = initialCreate
        return
      }
      const url = fixedUid ? `/user/${encodeURIComponent(fixedUid)}/blocks/new` : '/blocks/new'
      const key = `create::${url}`
      if (askedKey === key) return
      askedKey = key
      void (async () => {
        const r = await preloadData(url)
        if (askedKey !== key) return
        if (r.type !== 'loaded') {
          onAcl?.('auth.expired')
          return
        }
        const d = r.data as BlockCreateRouteData
        if (d.fact) {
          onAcl?.(d.fact)
          return
        }
        createData = d
      })()
      return
    }

    if (initialEdit && initialEdit === initialRevSnapshot.e) {
      editData = initialEdit
      return
    }
    const id = targetBlockId
    if (!id) {
      onAcl?.('auth.identity-unknown')
      return
    }
    const url = fixedUid
      ? `/user/${encodeURIComponent(fixedUid)}/blocks/${encodeURIComponent(id)}`
      : `/blocks/${encodeURIComponent(id)}`
    const key = `edit::${url}`
    if (askedKey === key) return
    askedKey = key
    void (async () => {
      const r = await preloadData(url)
      if (askedKey !== key) return
      if (r.type !== 'loaded') {
        onAcl?.('auth.expired')
        return
      }
      const d = r.data as BlockEditRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      editData = d
    })()
  })

  const allowedScopes = untrack(() =>
    mode === 'create'
      ? (initialCreate?.assignableScopes ?? [])
      : (initialEdit?.detail?.assignableScopes ?? []),
  )

  const desc = createBlockFormDescription(allowedScopes)
  const bound = bindComponentForm(forms, desc, {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  const detail = $derived(editData?.detail ?? null)
  const ready = $derived(mode === 'create' ? createData !== null : detail !== null)
  const canSubmit = $derived(mode === 'create' ? Boolean(createData?.canCreate) : Boolean(detail?.canSubmit))

  const fBlockId = bound.field('block_id')
  const fSubject = bound.field('subject')
  const fScope = bound.field('scope')
  const fReason = bound.field('reason')
  const fForever = bound.field('forever')
  const fUntil = bound.field('until')

  function seedFields(
    curMode: 'create' | 'edit',
    curUid: string | null,
    curSubj: string,
    cData: BlockCreateRouteData | null,
    eDetail: BlockEditRouteData['detail'],
  ): string {
    if (curMode === 'create') {
      const k = `create:${curUid ?? ''}:${curSubj}:${cData?.assignableScopes?.[0] ?? ''}`
      fBlockId?.onInput('')
      fSubject?.onInput(curUid ?? curSubj)
      const firstScope = cData?.assignableScopes?.[0]
      if (firstScope && isBlockScope(firstScope)) fScope?.onInput(firstScope)
      fForever?.onInput(true)
      fUntil?.onInput(null)
      return k
    }
    if (eDetail) {
      const k = `edit:${eDetail.block.id}:${eDetail.block.until ?? 'inf'}:${eDetail.block.reason}`
      fBlockId?.onInput(eDetail.block.id)
      fSubject?.onInput(eDetail.block.authId)
      if (isBlockScope(eDetail.block.scope)) fScope?.onInput(eDetail.block.scope)
      fReason?.onInput(eDetail.block.reason)
      fForever?.onInput(eDetail.block.until === null)
      fUntil?.onInput(eDetail.block.until !== null ? toDatetimeLocal(eDetail.block.until) : null)
      return k
    }
    return ''
  }

  // Синхронный засев на SSR / первом рендере (для no-JS HTML) + реактивный досев при preloadData
  let seededKey = untrack(() =>
    bound.state.result
      ? 'continued'
      : seedFields(
          mode,
          fixedUid,
          initialSubject,
          createData,
          editData?.detail ?? null,
        ),
  )

  $effect(() => {
    if (seededKey === 'continued') return
    const cData = createData
    const eDetail = detail
    const curMode = mode
    const curUid = fixedUid
    const curSubj = initialSubject
    const nextKey =
      curMode === 'create'
        ? `create:${curUid ?? ''}:${curSubj}:${cData?.assignableScopes?.[0] ?? ''}`
        : eDetail
          ? `edit:${eDetail.block.id}:${eDetail.block.until ?? 'inf'}:${eDetail.block.reason}`
          : ''
    if (!nextKey || seededKey === nextKey) return
    seededKey = nextKey
    untrack(() => {
      seedFields(curMode, curUid, curSubj, cData, eDetail)
    })
  })

  if (untrack(() => mode === 'create' && Boolean(fixedUid))) {
    mirrorToField(bound, 'subject', () => fixedUid ?? '')
  }

  // Подписка на выбор одиночного пользователя из модалки `user.picker`
  let lastPickerSeq = 0
  $effect(() => {
    if (mode !== 'create' || fixedUid) return
    const raw = modalsCtx?.view.sharedData[`${USER_PICKER_CHANNEL_PREFIX}block.subject`] as
      | UserPickerPayload
      | undefined
    if (!raw || raw.seq <= lastPickerSeq) return
    lastPickerSeq = raw.seq
    const pickedId = raw.ids[0] ?? ''
    untrack(() => fSubject?.onInput(pickedId))
  })

  let lastHandledSubmission = ''
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

  function applyDurationPreset(msOffset: number) {
    fForever?.onInput(false)
    fUntil?.onInput(toDatetimeLocal(Date.now() + msOffset))
  }

  const currentSubject = $derived(String(bound.f.subject.value ?? '').trim())
  const pickerHref = $derived.by(() => {
    const q = new URLSearchParams({
      mode: 'single',
      param: 'subject',
      from: selfHref,
    })
    if (currentSubject) q.set('picked', currentSubject)
    return `/users/pick?${q.toString()}`
  })

  const scopeOptionsForCreate = $derived(
    (createData?.assignableScopes ?? []).filter(isBlockScope),
  )

  const editScopeInfo = $derived(detail ? describeBlockScope(detail.block.scope) : null)
  const editIsDeleted = $derived(detail?.block.deletedAt != null)
  const editIsActive = $derived(
    Boolean(detail && !editIsDeleted && (detail.block.until === null || detail.block.until > Date.now())),
  )

  function guardSubmit(e: SubmitEvent) {
    if (!canSubmit) {
      e.preventDefault()
    }
  }
</script>

{#if !ready}
  <div class={cn('mx-auto flex w-full max-w-md flex-col gap-3', className)} aria-busy="true" data-testid="block-form-pending">
    <Skeleton class="h-5 w-44" />
    <Skeleton class="h-9 w-full" />
    <Skeleton class="h-20 w-full" />
    <Skeleton class="h-9 w-36" />
  </div>
{:else if mode === 'create'}
  <Form
    id="user-block-create"
    form={bound}
    hiddenFields={bound.hidden()}
    onsubmit={guardSubmit}
    class={cn('mx-auto flex w-full max-w-md flex-col gap-4 text-left', className)}
    data-testid="block-form-create"
  >
    <Common errors={bound.common} title="Проверьте форму" />

    <div hidden aria-hidden="true">
      <Field of={bound.f.block_id} />
      {#if fixedUid}
        <Field of={bound.f.subject} />
      {/if}
    </div>

    <h2 class="text-base font-semibold">{specBlocks.addTitle}</h2>

    {#if !fixedUid}
      <div class="flex flex-col gap-2" data-testid="block-create-subject-row">
        <Field of={bound.f.subject} />
        {#if createData?.canPickUsers}
          <div>
            <Button
              {...asModalLink(
                'user.picker',
                { mode: 'single', channel: 'block.subject', picked: currentSubject },
                { href: pickerHref },
              )}
              variant="outline"
              size="sm"
              data-testid="block-create-pick-user"
            >
              Выбрать из списка пользователей
            </Button>
          </div>
        {/if}
      </div>
    {/if}

    {#if scopeOptionsForCreate.length > 0}
      <Field of={bound.f.scope} />
    {/if}

    <Field of={bound.f.reason} />

    <div class="flex flex-col gap-2">
      <Field of={bound.f.forever} />
      {#if !bound.f.forever.value}
        <Field of={bound.f.until} />
      {/if}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-muted-foreground">Быстрый срок:</span>
        <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(3_600_000)}>
          +1 ч
        </Button>
        <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(86_400_000)}>
          +24 ч
        </Button>
        <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(7 * 86_400_000)}>
          +7 дн
        </Button>
        <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(30 * 86_400_000)}>
          +30 дн
        </Button>
      </div>
    </div>

    {#if canSubmit}
      <div class="pt-1">
        <Button
          type="submit"
          name="intent"
          value="save"
          task={formTask(bound.state, 'save')}
          data-testid="block-create-submit"
        >
          {specBlocks.addButton}
        </Button>
      </div>
    {/if}
  </Form>
{:else if detail}
  <Form
    id="user-block-edit"
    form={bound}
    hiddenFields={bound.hidden()}
    onsubmit={guardSubmit}
    class={cn('mx-auto flex w-full max-w-md flex-col gap-4 text-left', className)}
    data-testid="block-form-edit"
    data-readonly={!detail.canSubmit || undefined}
  >
    <Common errors={bound.common} title="Проверьте форму" />

    <div hidden aria-hidden="true">
      <Field of={bound.f.block_id} />
      <Field of={bound.f.subject} />
      <Field of={bound.f.scope} />
      {#if !(detail.canSubmit && detail.canEditReason)}
        <Field of={bound.f.reason} />
      {/if}
    </div>

    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-base font-semibold">
          {detail.canSubmit ? 'Редактирование блокировки' : 'Просмотр блокировки'}
        </h2>
        {#if editIsDeleted}
          <Badge variant="destructive">удалена</Badge>
        {:else if editIsActive}
          <Badge variant="destructive">активна</Badge>
        {:else}
          <Badge variant="outline">снята</Badge>
        {/if}
      </div>

      {#if detail.canDelete}
        <Button
          {...asModalLink(
            'user.blocks.delete',
            fixedUid
              ? { blockId: detail.block.id, uid: fixedUid }
              : { blockId: detail.block.id },
          )}
          variant="outline"
          size="sm"
          class="shrink-0 text-destructive"
          data-testid="block-delete-open"
        >
          Удалить
        </Button>
      {/if}
    </div>

    {#if !fixedUid}
      <!-- Глобальный список без `uid`: чисто визуальное disabled-поле с переданным
           `id` целевого пользователя (без `name` и вне `defineForm`) + кнопка профиля -->
      <div class="flex flex-col gap-1.5" data-testid="block-form-target-user">
        <Label>Пользователь (ID)</Label>
        <div class="flex items-center gap-2">
          <Input
            value={detail.block.authId}
            disabled
            readonly
            class="min-w-0 flex-1 font-mono text-xs"
            data-testid="block-target-id-input"
          />
          <Button
            {...asModalLink('user.profile', { id: detail.block.authId })}
            variant="outline"
            size="sm"
            data-testid="block-open-profile"
          >
            Профиль
          </Button>
        </div>
      </div>
    {/if}

    <div class="flex flex-col gap-1.5">
      <Label>{specBlocks.scopeLabel}</Label>
      <Input
        value={editScopeInfo ? `${editScopeInfo.title} — ${editScopeInfo.description}` : detail.block.scope}
        disabled
        readonly
        data-testid="block-scope-readonly"
      />
    </div>

    {#if detail.canSubmit && detail.canEditReason}
      <Field of={bound.f.reason} />
    {:else}
      <div class="flex flex-col gap-1.5">
        <Label>{specBlocks.reasonLabel}</Label>
        <Textarea
          value={detail.block.reason}
          disabled
          readonly
          rows={2}
          data-testid="block-reason-readonly"
        />
      </div>
    {/if}

    {#if detail.canSubmit && detail.canEditUntil}
      <div class="flex flex-col gap-2">
        <Field of={bound.f.forever} />
        {#if !bound.f.forever.value}
          <Field of={bound.f.until} />
        {/if}
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs text-muted-foreground">Быстрый срок:</span>
          <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(3_600_000)}>
            +1 ч
          </Button>
          <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(86_400_000)}>
            +24 ч
          </Button>
          <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(7 * 86_400_000)}>
            +7 дн
          </Button>
          <Button type="button" variant="outline" size="sm" onclick={() => applyDurationPreset(30 * 86_400_000)}>
            +30 дн
          </Button>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-1.5">
        <Label>{specBlocks.untilLabel}</Label>
        <Input
          value={detail.block.until === null
            ? specBlocks.foreverText
            : specBlocks.untilText(detail.block.until)}
          disabled
          readonly
          data-testid="block-until-readonly"
        />
      </div>
    {/if}

    <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>Создана: <TimeAgo value={detail.block.at} /></span>
      {#if detail.block.by}
        <span>· Автор ID: <code>{detail.block.by.slice(0, 8)}</code></span>
      {/if}
      {#if detail.block.deletedAt}
        <span class="text-destructive">· Удалена: <TimeAgo value={detail.block.deletedAt} /></span>
      {/if}
    </div>

    {#if detail.canSubmit}
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="submit"
          name="intent"
          value="save"
          task={formTask(bound.state, 'save')}
          data-testid="block-save-submit"
        >
          Сохранить
        </Button>
        {#if editIsActive}
          <Button
            type="submit"
            name="intent"
            value="lift"
            variant="outline"
            task={formTask(bound.state, 'lift')}
            data-testid="block-lift-submit"
          >
            {specBlocks.liftButton} сейчас
          </Button>
        {/if}
      </div>
    {/if}
  </Form>
{/if}
