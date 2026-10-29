<script lang="ts" module>
  /** Префикс ключа общей доски модалок (`sharedData`), куда пикер кладёт результат. */
  export const USER_PICKER_CHANNEL_PREFIX = 'picker:'

  export interface UserPickerPayload {
    seq: number
    ids: string[]
  }
</script>

<script lang="ts">
  /**
   * Универсальный пикер пользователей поверх `SeedUsersList` (`single` или
   * `multiple`) на два носителя:
   *  - модалка `user.picker` (JS): выбор хранится реактивно, подтверждение
   *    передаёт выбранные `id` вызывающей модалке/странице через `onConfirm`
   *    (общая доска модалок) без перезагрузки и без потери введённых полей;
   *  - страница `/users/pick` (fallback без JS и прямой переход): выбор и шаг
   *    живут в query-параметрах (`?picked=…`, `?upicks=…`, `?users.ids=…`),
   *    кнопка «Применить» возвращает GET-переходом на `fromHref` с подстановкой
   *    выбранных `id` в целевой параметр `targetParam`.
   */
  import { onDestroy, untrack } from 'svelte'
  import { createAttachmentKey } from 'svelte/attachments'
  import { Steps, stepLink, useSteps } from '#components/steps/index.js'
  import { Button } from '#components/ui/index.js'
  import { asLink, type LinkAttrs } from '#hooks/links/index.js'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { getClientStore, getState, hasPaginator, setExtra } from '#lib/paginate/index.js'
  import Acl from './Acl.svelte'
  import SeedUsersList from './SeedUsersList.svelte'
  import { SEED_USERS_NAME } from './seed-users/source.js'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUserView } from '../types.js'

  interface Props {
    mode?: 'single' | 'multiple'
    initialPicked?: readonly string[]
    fromHref?: string
    targetParam?: string
    onConfirm?: (ids: string[]) => void
    onCancel?: () => void
    onAcl?: (fact: AuthErrorCode) => void
    class?: string
  }

  let {
    mode = 'multiple',
    initialPicked = [],
    fromHref = '/',
    targetParam = 'picked',
    onConfirm,
    onCancel,
    onAcl,
    class: className,
  }: Props = $props()

  const PICK_ATTACH = createAttachmentKey()
  const isModalMode = $derived(typeof onConfirm === 'function')

  let localAcl = $state<AuthErrorCode | null>(null)
  let localPicked = $state<string[]>([...untrack(() => initialPicked).filter(Boolean)])
  let localStep = $state<'pick' | 'chosen'>('pick')

  const urlPicked = $derived.by(() => {
    const raw = visibleAddress().url.searchParams.get('picked')
    if (raw === null) return [...initialPicked.filter(Boolean)]
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  })

  const activeList = $derived(isModalMode ? localPicked : urlPicked)
  const pickedSet = $derived(new Set(activeList))

  function clearPaginatorIdsSlice() {
    if (!hasPaginator(SEED_USERS_NAME)) return
    const st = getState(getClientStore(), SEED_USERS_NAME)
    if (st?.extra?.ids) {
      void setExtra(getClientStore(), SEED_USERS_NAME, { ids: undefined })
    }
  }

  onDestroy(() => {
    if (untrack(() => isModalMode)) clearPaginatorIdsSlice()
  })

  function toggleLocal(id: string) {
    if (mode === 'single') {
      localPicked = localPicked[0] === id ? [] : [id]
    } else {
      const next = new Set(localPicked)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localPicked = [...next]
    }
    if (localStep === 'chosen' && hasPaginator(SEED_USERS_NAME)) {
      void setExtra(getClientStore(), SEED_USERS_NAME, {
        ids: localPicked.length ? localPicked.join(',') : undefined,
      })
    }
  }

  const rowAttrs = (user: SeedUserView): LinkAttrs => {
    if (isModalMode) {
      return {
        href: '#',
        title: mode === 'single' ? 'Выбрать пользователя' : 'Переключить выбор пользователя',
        [PICK_ATTACH]: (el: HTMLElement) => {
          const onClick = (e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            e.preventDefault()
            toggleLocal(user.id)
          }
          el.addEventListener('click', onClick)
          return () => el.removeEventListener('click', onClick)
        },
      }
    }

    const url = visibleAddress().url
    const next = new Set(pickedSet)
    if (mode === 'single') {
      const was = next.has(user.id)
      next.clear()
      if (!was) next.add(user.id)
    } else if (next.has(user.id)) {
      next.delete(user.id)
    } else {
      next.add(user.id)
    }
    const sp = new URLSearchParams(url.searchParams.toString())
    if (next.size) sp.set('picked', [...next].join(','))
    else sp.delete('picked')
    if (sp.has('users.ids')) {
      if (next.size) sp.set('users.ids', [...next].join(','))
      else sp.delete('users.ids')
    }
    const qs = sp.toString()
    return {
      ...asLink(qs ? `${url.pathname}?${qs}` : url.pathname, { replace: true }),
      title: mode === 'single' ? 'Выбрать пользователя' : 'Переключить выбор пользователя',
    }
  }

  const stepHref = (step: 'pick' | 'chosen', withSlice: boolean): string => {
    const url = visibleAddress().url
    const sp = new URLSearchParams(url.searchParams.toString())
    sp.set('upicks', step)
    if (withSlice && pickedSet.size) sp.set('users.ids', [...pickedSet].join(','))
    else sp.delete('users.ids')
    return `${url.pathname}?${sp.toString()}`
  }

  async function switchLocalStep(next: 'pick' | 'chosen') {
    localStep = next
    host.set(next)
    if (!hasPaginator(SEED_USERS_NAME)) return
    await setExtra(getClientStore(), SEED_USERS_NAME, {
      ids: next === 'chosen' && localPicked.length ? localPicked.join(',') : undefined,
    })
  }

  const host = useSteps({
    owner: 'user-picker-modal',
    mode: untrack(() => isModalMode) ? 'local' : 'url',
    key: 'upicks',
    steps: () => [
      { key: 'pick', label: mode === 'single' ? 'Выбор пользователя' : 'Выбор пользователей' },
      { key: 'chosen', label: 'Выбранные' },
    ],
    current: () =>
      isModalMode
        ? localStep
        : ((visibleAddress().url.searchParams.get('upicks') as 'pick' | 'chosen' | null) ?? 'pick'),
    onSwitch: (stepKey) => switchLocalStep(stepKey as 'pick' | 'chosen'),
  })

  const applyHref = $derived.by(() => {
    const dest = new URL(fromHref, 'http://local.invalid')
    const joined = [...pickedSet].join(',')
    if (joined) dest.searchParams.set(targetParam, joined)
    else dest.searchParams.delete(targetParam)
    const qs = dest.searchParams.toString()
    return qs ? `${dest.pathname}?${qs}` : dest.pathname
  })

  const clearHref = $derived.by(() => {
    const url = visibleAddress().url
    const sp = new URLSearchParams(url.searchParams.toString())
    sp.delete('picked')
    sp.delete('users.ids')
    sp.set('upicks', 'pick')
    const qs = sp.toString()
    return qs ? `${url.pathname}?${qs}` : url.pathname
  })

  function handleAcl(fact: AuthErrorCode) {
    localAcl = fact
    onAcl?.(fact)
  }
</script>

<section class={className} data-testid="user-picker">
  {#if localAcl && !onAcl}
    <Acl status={localAcl} backHref={fromHref} />
  {:else}
    <Steps {host} label={mode === 'single' ? 'Выбор пользователя' : 'Выбор пользователей'} nav>
      {#snippet pick()}
        <div class="flex flex-col gap-3">
          <SeedUsersList
            {rowAttrs}
            isSelected={(id) => pickedSet.has(id)}
            onAcl={handleAcl}
          />
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Выбрано: <strong data-testid="user-picker-count">{pickedSet.size}</strong>
              {#if isModalMode}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onclick={() => void switchLocalStep('chosen')}
                >
                  К выбранным →
                </Button>
              {:else}
                <a
                  {...stepLink(host, 'chosen')}
                  href={stepHref('chosen', true)}
                  class="ml-3 font-medium underline underline-offset-4"
                >
                  К выбранным →
                </a>
              {/if}
            </span>
          </div>
        </div>
      {/snippet}
      {#snippet chosen()}
        <div class="flex flex-col gap-3">
          {#if pickedSet.size}
            <SeedUsersList
              {rowAttrs}
              isSelected={(id) => pickedSet.has(id)}
              onAcl={handleAcl}
            />
          {:else}
            <p class="text-sm text-muted-foreground">Пока никто не выбран.</p>
          {/if}
          <div class="text-sm">
            {#if isModalMode}
              <Button
                type="button"
                variant="link"
                size="sm"
                onclick={() => void switchLocalStep('pick')}
              >
                ← К выбору
              </Button>
            {:else}
              <a
                {...stepLink(host, 'pick')}
                href={stepHref('pick', false)}
                class="font-medium underline underline-offset-4"
              >
                ← К выбору
              </a>
            {/if}
          </div>
        </div>
      {/snippet}
    </Steps>

    <div class="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
      {#if pickedSet.size > 0}
        {#if isModalMode}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onclick={() => {
              localPicked = []
              clearPaginatorIdsSlice()
            }}
            data-testid="user-picker-clear"
          >
            Сбросить выбор
          </Button>
        {:else}
          <Button
            {...asLink(clearHref, { replace: true })}
            variant="outline"
            size="sm"
            data-testid="user-picker-clear"
          >
            Сбросить выбор
          </Button>
        {/if}
      {/if}
      {#if isModalMode}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={() => {
            clearPaginatorIdsSlice()
            onCancel?.()
          }}
          data-testid="user-picker-cancel"
        >
          Отмена
        </Button>
        <Button
          type="button"
          size="sm"
          onclick={() => {
            clearPaginatorIdsSlice()
            onConfirm?.([...pickedSet])
          }}
          data-testid="user-picker-apply"
        >
          Применить
        </Button>
      {:else}
        <Button href={fromHref} variant="ghost" size="sm" data-testid="user-picker-cancel">
          Отмена
        </Button>
        <Button href={applyHref} size="sm" data-testid="user-picker-apply">
          Применить
        </Button>
      {/if}
    </div>
  {/if}
</section>
