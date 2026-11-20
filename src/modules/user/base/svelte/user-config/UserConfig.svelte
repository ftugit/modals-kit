<script lang="ts">
  /**
   * Универсальный компонент настроек пользователя (`UserConfig`):
   * работает одинаково в модалке `user.config.edit` и на страницах
   * `/user/config` (свои настройки) и `/user/[id]/config` (настройки по UUID).
   *
   * Редактируемые ключи рендерятся полями `#core/ui/form`, а ключи,
   * доступные только для чтения (`session.ipLock` у владельца, чужой конфиг
   * под `config.read`), показываются строками `read-only` без включения в форму.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { readQuery } from '#core/lib/address/keys.js'
  import { visibleAddress } from '#core/lib/address/sveltekit.js'
  import type { Result } from '#core/lib/form/index.js'
  import { Steps, useSteps } from '#core/ui/steps/index.js'
  import type { Snippet } from 'svelte'
  import { configStepOf, configStepsFor } from './extensions.js'
  import { useModalLink } from '#core/hooks/links/index.js'
  import { Button, Skeleton, Surface } from '#core/ui/index.js'
  import { cn } from '#core/ui/utils.js'
  import type { AuthErrorCode } from '../../model/error.js'
  import {
    CONFIG_GROUPS,
    CONFIG_GROUP_ORDER,
    specConfig,
    type ConfigGroupKey,
  } from '../../service/spec-config.js'
  import type { UserConfigRouteData, UserConfigSlice } from '../../model/types.js'
  import { vault } from '../vault.svelte.js'
  import Acl, { type UserSurfaceVariant } from '../Acl.svelte'
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
    /** Только тело без Acl/Surface: секция внутри SettingsHost. */
    embedded?: boolean
    class?: string
    /** Режим шагов: страница — hybrid/url, модалка — local. */
    stepsMode?: 'url' | 'local' | 'hybrid'
    /** Контекст носителя для встроенного списка сессий. */
    sessionsContext?: 'page' | 'modal'
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
    embedded = false,
    class: className,
    stepsMode = 'local',
    sessionsContext = 'page',
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

  let sessionsParts = $state<{ header: Snippet; body: Snippet } | null>(null)

  const nonEmptyGroupKeys = $derived<ConfigGroupKey[]>(
    slice
      ? CONFIG_GROUP_ORDER.filter((gk) => slice.items.some((item) => item.group === gk))
      : [],
  )

  const steps = useSteps({
    owner: 'user-config',
    mode: untrack(() => stepsMode),
    key: 'user_config_step',
    steps: () =>
      nonEmptyGroupKeys.map((gk) => ({
        key: gk,
        label: CONFIG_GROUPS[gk].title,
        filled: true,
      })),
    current: () => {
      const fromUrl = readQuery(visibleAddress().url.searchParams, 'user_config_step')
      if (typeof fromUrl === 'string') {
        const seg = fromUrl.split('.')[0]
        if (nonEmptyGroupKeys.includes(seg as ConfigGroupKey)) {
          return fromUrl
        }
      }
      return nonEmptyGroupKeys[0] ?? 'profile'
    },
  })

  const showStepsNav = $derived(nonEmptyGroupKeys.length >= 2)
  // Шаг «Сессии» поставляет субмодуль; без него раздел настроек остаётся.
  const sessionsStep = $derived(configStepOf('sessions'))
  const extraSteps = $derived(configStepsFor('security', slice?.isOwn ?? false).filter((step) => step.id !== 'sessions'))
  const activeExtraStep = $derived.by(() => {
    const key = steps.fullKey
    if (typeof key !== 'string' || !key.startsWith('security.')) return null
    const id = key.split('.')[1]
    return extraSteps.find((step) => step.id === id) ?? null
  })

  // Запрещённый шаг, открытый прямой ссылкой: его нет в списке разрешённых
  // групп, поэтому в навигации он скрыт; при прямом переходе показываем ACL
  // вместо тихого отката к первому шагу.
  const requestedTopStep = $derived.by(() => {
    const fromUrl = readQuery(visibleAddress().url.searchParams, 'user_config_step')
    if (typeof fromUrl !== 'string' || !fromUrl) return null
    return fromUrl.split('.')[0]
  })
  const isForbiddenStep = $derived(
    requestedTopStep !== null &&
      !nonEmptyGroupKeys.includes(requestedTopStep as ConfigGroupKey),
  )

  const sessionsMode = $derived(
    steps.currentKey === 'security' &&
      typeof steps.fullKey === 'string' &&
      (steps.fullKey === 'security.sessions' ||
        (steps.fullKey as string).startsWith('security.sessions.')),
  )
  $effect(() => {
    if (!sessionsMode) sessionsParts = null
  })
  const asModalLink = useModalLink()
  const formKey = $derived(
    slice
      ? `${slice.uid}::${resetTick}::${slice.items
          .filter((i) => i.editable)
          .map((i) => `${i.fieldName}:${i.kind}:${i.editable}`)
          .join('|')}`
      : 'empty',
  )
</script>

{#snippet configSteps()}
  <Steps host={steps} label="Разделы настроек" />
{/snippet}

{#snippet sessionsLink()}
  {#if sessionsMode}
    <a
      href={steps.href('security')}
      class="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-sm font-medium hover:bg-muted"
      data-testid="config-sessions-back"
      onclick={(e: MouseEvent) => {
        if (steps.mode !== 'url') {
          e.preventDefault()
          void steps.switch('security')
        }
      }}
    >
      Настройки
    </a>
  {:else}
          <a
        href={steps.href('security.sessions')}
        class="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-sm font-medium hover:bg-muted"
        data-testid="config-sessions-open"
        onclick={(e: MouseEvent) => {
          if (steps.mode !== 'url') {
            e.preventDefault()
            void steps.switch('security.sessions')
          }
        }}
      >
        Сессии
      </a>
      {#each extraSteps as step (step.id)}
        <a
          href={steps.href(`security.${step.id}`)}
          class="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-sm font-medium hover:bg-muted"
          data-testid={`config-${step.id}-open`}
          onclick={(e: MouseEvent) => {
            if (steps.mode !== 'url') {
              e.preventDefault()
              void steps.switch(`security.${step.id}`)
            }
          }}
        >
          {step.label ?? step.id}
        </a>
      {/each}
  {/if}
{/snippet}

{#snippet sessionsEnd()}
  <div class="flex items-center gap-2">
    {#if slice?.isOwn}
      {@render sessionsLink()}
    {/if}
    {#if sessionsMode && sessionsParts}
      {@render sessionsParts.header()}
    {/if}
  </div>
{/snippet}

{#snippet configTarget()}
  {#if slice && !slice.isOwn}
    <p class="font-mono text-xs text-muted-foreground" data-testid="user-config-target-uid">
      {slice.uid}
    </p>
  {/if}
{/snippet}

{#snippet configBody()}
{#if !slice}
      <div class="flex flex-col gap-3" aria-busy="true" data-testid="user-config-pending">
        <Skeleton class="h-6 w-40" />
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-24 w-full" />
      </div>
    {:else if isForbiddenStep}
      <Acl status="auth.forbidden" authorized={isAuthorized} enabled={isEnabled} backHref={doneHref} {variant} />
    {:else}
      {#if slice.items.length === 0}
        <div class="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          <p class="font-medium text-foreground">{specConfig.emptyTitle}</p>
          <p class="mt-1 text-xs">{specConfig.emptyText}</p>
        </div>
      {:else if activeExtraStep}
        {@const ExtraStep = activeExtraStep.component}
        {#key activeExtraStep.id}
          <ExtraStep uid={slice.isOwn ? null : slice.uid} context={sessionsContext} />
        {/key}
      {:else if sessionsMode && sessionsStep}
        {@const SessionsStep = sessionsStep.component}
        {#key 'sessions'}
          <SessionsStep
            uid={slice.isOwn ? null : slice.uid}
            context={sessionsContext}
            onAcl={(fact) => {
              // ACL отказ — возвращаемся к настройкам.
              void steps.switch('security')
              onAcl?.(fact as never)
            }}
            frame={(parts) => {
              sessionsParts = parts
              return null
            }}
          />
        {/key}
        {#if sessionsParts}
          {@render sessionsParts.body()}
        {/if}
      {:else}
        {#key formKey}
          <UserConfigFields
            {slice}
            {steps}
            {showStepsNav}
            embedSteps={false}
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
{/snippet}

{#if embedded}
  {#if showStepsNav}
    <div class="flex flex-wrap items-center gap-2 border-b border-border pb-3">
      {@render configSteps()}
    </div>
  {/if}
  {@render configBody()}
{:else}
  <Acl
    allow="user"
    authorized={isAuthorized}
    enabled={isEnabled}
    backHref={doneHref}
    {variant}
    class={className}
  >
    <Surface
      {variant}
      class={cn('mx-auto w-full max-w-md', className)}
      title={slice && !slice.isOwn ? specConfig.foreignTitle : undefined}
      description={slice && !slice.isOwn ? configTarget : undefined}
      controls={slice?.isOwn || showStepsNav
        ? {
            ...(showStepsNav ? { start: configSteps } : {}),
            ...(slice?.isOwn ? { end: sessionsEnd } : {}),
          }
        : undefined}
      data-testid="user-config-root"
    >
      {@render configBody()}
    </Surface>
  </Acl>
{/if}
