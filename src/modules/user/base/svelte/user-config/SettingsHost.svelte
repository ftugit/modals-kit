<script lang="ts">
  /**
   * Хост настроек: пункты приходят из реестра, навигация — rail внутри Surface.
   * Секция сама решает, что рисовать внутри (шаги, форма, список); хост только
   * выбирает активный пункт по `settings_section`; `user_config_step` остаётся
   * внутренним ключом шагов секции и хосту не принадлежит.
   */
  import { readQuery } from '#core/lib/address/keys.js'
  import { visibleAddress } from '#core/lib/address/sveltekit.js'
  import type { Result } from '#core/lib/form/index.js'
  import { settingsSectionsFor, type SettingsContext } from '#core/ui/settings/index.js'
  import { Button, Empty, Surface } from '#core/ui/index.js'
  import { cn } from '#core/ui/utils.js'
  import Acl, { type UserSurfaceVariant } from '../Acl.svelte'
  import { vault } from '../vault.svelte.js'
  import type { AuthErrorCode } from '../../model/error.js'
  import type { UserConfigRouteData, UserConfigSlice } from '../../model/types.js'
  import type { UserSettingsScreen } from './host-screen.js'

  interface Props {
    uid?: string | null
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
    stepsMode?: 'url' | 'local' | 'hybrid'
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
    class: className,
    stepsMode = 'local',
    sessionsContext = 'page',
  }: Props = $props()

  const isAuthorized = $derived(authorized !== undefined ? authorized : vault.authorized)
  const isEnabled = $derived(enabled !== undefined ? enabled : initial?.enabled)

  const ctx = $derived<SettingsContext>({
    uid: uid?.trim() || null,
    surface: variant === 'card' ? 'page' : 'modal',
    stepsMode,
    isOwn: !uid?.trim(),
    canRead: true,
    canEdit: true,
  })

  const sections = $derived(settingsSectionsFor<UserSettingsScreen>(ctx))

  const requested = $derived.by(() => {
    const raw = readQuery(visibleAddress().url.searchParams, 'settings_section')
    return typeof raw === 'string' ? raw.split('.')[0] : null
  })

  const current = $derived(
    sections.find((section) => section.id === requested) ?? sections[0] ?? null,
  )

  const screen = $derived<UserSettingsScreen>({
    initial,
    action,
    form,
    doneHref,
    onAcl,
    onChange,
    onDone,
    variant,
    sessionsContext,
  })

  function sectionHref(id: string): string {
    const url = new URL(visibleAddress().url)
    url.searchParams.set('settings_section', id)
    return `${url.pathname}${url.search}`
  }
</script>

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
    class={cn('mx-auto w-full max-w-3xl', className)}
    rail={sections.length > 1 ? rail : undefined}
    railLabel="Разделы настроек"
    data-testid="settings-host"
  >
    {#if current}
      {@const Section = current.component}
      <Section {ctx} {screen} />
    {:else}
      <Empty
        title="Настроек нет"
        description="Нет разделов, доступных этому пользователю."
        data-testid="settings-empty"
      />
    {/if}
  </Surface>
</Acl>

{#snippet rail()}
  {#each sections as section (section.id)}
    <Button
      href={sectionHref(section.id)}
      variant={section.id === current?.id ? 'secondary' : 'ghost'}
      size="sm"
      class="justify-start"
      aria-current={section.id === current?.id ? 'page' : undefined}
      data-testid={`settings-tab-${section.id}`}
    >
      {section.label}
    </Button>
  {/each}
{/snippet}
