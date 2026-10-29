<script lang="ts">
  /**
   * Универсальный компонент настроек пользователя (`UserConfig`):
   * работает одинаково в модалке `user.config.edit` и на страницах
   * `/user/config` (свои настройки) и `/user/[id]/config` (настройки по UUID).
   *
   * Редактируемые ключи рендерятся полями `#components/form`, а ключи,
   * доступные только для чтения (`session.ipLock` у владельца, чужой конфиг
   * под `config.read`), показываются строками `read-only` без включения в форму.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { readQuery } from '#lib/address/keys.js'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import type { Result } from '#lib/form/index.js'
  import { useSteps } from '#components/steps/index.js'
  import { Skeleton } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import type { AuthErrorCode } from '../../error.js'
  import {
    CONFIG_GROUPS,
    CONFIG_GROUP_ORDER,
    specConfig,
    type ConfigGroupKey,
  } from '../../spec-config.js'
  import type { UserConfigRouteData, UserConfigSlice } from '../../types.js'
  import { vault } from '../../vault.svelte.js'
  import Acl, { userSurfaceVariants, type UserSurfaceVariant } from '../Acl.svelte'
  import UserConfigFields from './UserConfigFields.svelte'

  interface Props {
    /** Целевой пользователь; пусто — свои настройки (`/user/config`). */
    uid?: string | null
    /** Снапшот `load` от носителя (страница или загрузчик модалки). */
    initial?: UserConfigRouteData | null
    action?: string
    form?: { result?: Result } | null
    authorized?: boolean
    enabled?: boolean
    doneHref?: string
    onAcl?: (fact: AuthErrorCode) => void
    onChange?: (next: UserConfigSlice) => void
    onDone?: () => void
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    uid = null,
    initial = null,
    action,
    form,
    authorized,
    enabled,
    doneHref = '/',
    onAcl,
    onChange,
    onDone,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const fixedUid = $derived(uid?.trim() || null)
  const isAuthorized = $derived(authorized !== undefined ? authorized : vault.authorized)
  const isEnabled = $derived(enabled !== undefined ? enabled : initial?.enabled)

  let routeData = $state<UserConfigRouteData | null>(untrack(() => initial))
  let resetTick = $state(0)
  let askedUrl = ''

  $effect(() => {
    if (initial) {
      routeData = initial
      return
    }
    const targetUrl = fixedUid
      ? `/user/${encodeURIComponent(fixedUid)}/config`
      : '/user/config'
    if (askedUrl === targetUrl) return
    askedUrl = targetUrl
    void (async () => {
      const r = await preloadData(targetUrl)
      if (askedUrl !== targetUrl) return
      if (r.type !== 'loaded') {
        onAcl?.('auth.expired')
        return
      }
      const d = r.data as UserConfigRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      routeData = d
    })()
  })

  const slice = $derived<UserConfigSlice | null>(routeData?.slice ?? null)

  const nonEmptyGroupKeys = $derived<ConfigGroupKey[]>(
    slice
      ? CONFIG_GROUP_ORDER.filter((gk) => slice.items.some((item) => item.group === gk))
      : [],
  )

  const steps = useSteps({
    owner: 'user-config',
    mode: 'local',
    key: 'user_config_step',
    steps: () =>
      nonEmptyGroupKeys.map((gk) => ({
        key: gk,
        label: CONFIG_GROUPS[gk].title,
        filled: true,
      })),
    current: () => {
      const fromUrl = readQuery(visibleAddress().url.searchParams, 'user_config_step')
      if (typeof fromUrl === 'string' && nonEmptyGroupKeys.includes(fromUrl as ConfigGroupKey)) {
        return fromUrl
      }
      return nonEmptyGroupKeys[0] ?? 'profile'
    },
  })

  const showStepsNav = $derived(nonEmptyGroupKeys.length >= 2)
  const formKey = $derived(
    slice
      ? `${slice.uid}::${resetTick}::${slice.items
          .filter((i) => i.editable)
          .map((i) => i.fieldName)
          .join(',')}`
      : 'empty',
  )
</script>

<Acl
  allow="user"
  authorized={isAuthorized}
  enabled={isEnabled}
  backHref={doneHref}
  {variant}
  class={className}
>
  <section
    class={cn(
      'mx-auto flex w-full max-w-md flex-col gap-4 text-left',
      userSurfaceVariants({ variant }),
      className,
    )}
    data-testid="user-config-root"
  >
    {#if !slice}
      <div class="flex flex-col gap-3" aria-busy="true" data-testid="user-config-pending">
        <Skeleton class="h-6 w-40" />
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-24 w-full" />
      </div>
    {:else}
      <header class="flex flex-col gap-1">
        <h2 class="text-base font-semibold">
          {slice.isOwn ? specConfig.ownTitle : specConfig.foreignTitle}
        </h2>
        {#if !slice.isOwn}
          <p class="font-mono text-xs text-muted-foreground" data-testid="user-config-target-uid">
            {slice.uid}
          </p>
        {/if}
      </header>

      {#if slice.items.length === 0}
        <div class="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          <p class="font-medium text-foreground">{specConfig.emptyTitle}</p>
          <p class="mt-1 text-xs">{specConfig.emptyText}</p>
        </div>
      {:else}
        {#key formKey}
          <UserConfigFields
            {slice}
            {steps}
            {showStepsNav}
            {action}
            {form}
            {doneHref}
            onResetSlice={(next) => {
              if (routeData) routeData = { ...routeData, slice: next }
              resetTick += 1
              onChange?.(next)
            }}
            onSaved={(next) => {
              if (routeData) routeData = { ...routeData, slice: next }
              onChange?.(next)
              onDone?.()
            }}
            onClose={onDone}
          />
        {/key}
      {/if}
    {/if}
  </section>
</Acl>
