<script lang="ts">
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { Skeleton } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import type { Result } from '#lib/form/index.js'
  import type { AuthErrorCode } from '../../error.js'
  import type { BlockCreateRouteData, BlockEditRouteData } from '../../types.js'
  import { userSurfaceVariants, type UserSurfaceVariant } from '../Acl.svelte'
  import BlockFormBody from './BlockFormBody.svelte'

  interface Props {
    mode: 'create' | 'edit'
    /** Фиксированный `uid` из родительского `BlocksList` (пусто — глобальный список). */
    uid?: string | null
    /** Идентификатор записи блокировки (обязателен для `mode === 'edit'`). */
    blockId?: string | null
    /** Начальный список выбранных целевых пользователей в глобальном `create` (из фильтра `uids` или `/users/pick`). */
    initialSubjects?: readonly string[]
    /** Одиночный начальный `subject` (обратная совместимость с `?subject=…`). */
    initialSubject?: string
    /** Данные `load` страницы создания (SSR/no-JS). */
    initialCreate?: BlockCreateRouteData | null
    /** Данные `load` страницы редактирования/просмотра (SSR/no-JS). */
    initialEdit?: BlockEditRouteData | null
    /** Текущий путь страницы для возврата из no-JS `/users/pick`. */
    selfHref?: string
    action?: string
    form?: { result?: Result } | null
    onSubjectsChange?: (ids: string[]) => void
    onAcl?: (fact: AuthErrorCode) => void
    onDone?: () => void
    variant?: UserSurfaceVariant
    class?: string
  }

  let props: Props = $props()
  const fixedUid = $derived(props.uid?.trim() || null)
  const targetBlockId = $derived(props.blockId?.trim() || null)
  let createData = $state<BlockCreateRouteData | null>(untrack(() => props.initialCreate ?? null))
  let editData = $state<BlockEditRouteData | null>(untrack(() => props.initialEdit ?? null))
  let askedKey = ''

  $effect(() => {
    if (props.mode === 'create') {
      if (props.initialCreate) {
        askedKey = ''
        createData = props.initialCreate
        return
      }
      const url = fixedUid ? `/user/${encodeURIComponent(fixedUid)}/blocks/new` : '/blocks/new'
      const key = `create::${url}`
      if (askedKey === key) return
      askedKey = key
      createData = null
      let cancelled = false
      void (async () => {
        const r = await preloadData(url)
        if (cancelled || askedKey !== key) return
        if (r.type !== 'loaded') { props.onAcl?.('auth.expired'); return }
        const d = r.data as BlockCreateRouteData
        if (d.fact) { props.onAcl?.(d.fact); return }
        createData = d
      })()
      return () => { cancelled = true }
    }
    if (props.initialEdit) {
      askedKey = ''
      editData = props.initialEdit
      return
    }
    const id = targetBlockId
    if (!id) { editData = null; props.onAcl?.('auth.identity-unknown'); return }
    const url = fixedUid
      ? `/user/${encodeURIComponent(fixedUid)}/blocks/${encodeURIComponent(id)}`
      : `/blocks/${encodeURIComponent(id)}`
    const key = `edit::${url}`
    if (askedKey === key) return
    askedKey = key
    editData = null
    let cancelled = false
    void (async () => {
      const r = await preloadData(url)
      if (cancelled || askedKey !== key) return
      if (r.type !== 'loaded') { props.onAcl?.('auth.expired'); return }
      const d = r.data as BlockEditRouteData
      if (d.fact) { props.onAcl?.(d.fact); return }
      editData = d
    })()
    return () => { cancelled = true }
  })

  const ready = $derived(props.mode === 'create' ? createData !== null : Boolean(editData?.detail))
  const allowedScopes = $derived(
    props.mode === 'create' ? (createData?.assignableScopes ?? []) : (editData?.detail?.assignableScopes ?? []),
  )
</script>

{#if ready}
  {#key `${props.mode}:${allowedScopes.join(',')}`}
    <BlockFormBody {...props} initialCreate={createData} initialEdit={editData} />
  {/key}
{:else}
  <div class={cn('mx-auto flex w-full max-w-md flex-col gap-3', userSurfaceVariants({ variant: props.variant ?? 'plain' }), props.class)} aria-busy="true" data-testid="block-form-pending">
    <Skeleton class="h-5 w-44" />
    <Skeleton class="h-9 w-full" />
    <Skeleton class="h-20 w-full" />
    <Skeleton class="h-9 w-36" />
  </div>
{/if}
