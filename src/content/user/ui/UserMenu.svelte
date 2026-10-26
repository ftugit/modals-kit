<script lang="ts">
  /**
   * Кнопка пользователя в шапке.
   *
   * Меню авторизованного: на широкой ширине — всплывашка у кнопки
   * (`host.floating`, адрес не меняется: этому меню URL не нужен), на узкой —
   * модалка `user.menu` (`?modal=user.menu`). Без JS обе ветки ведут на
   * страницу `/user/menu`: широкая ветка — обычная ссылка, клик перехватывается
   * только после гидратации; узкая — `asModalLink` с тем же фолбэком.
   * Гость: модалка входа (`user.auth`), без JS — страница входа.
   *
   * Читает исключительно единый реактивный `vault` (на SSR и до гидратации
   * `vault` прозрачно отдаёт `page.data.user`, в браузере — состояние RAM).
   */
  import { Portal } from '@ark-ui/svelte/portal'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#hooks/js-only.svelte.js'
  import {
    createIsNarrow,
    tryUseModals,
    type HostFloatingCloseReason,
  } from '#lib/modals/svelte/index.js'
  import { userAuthRoute, userMenuRoute } from '../routes.js'
  import { vault } from '../vault.svelte.js'
  import MenuBody from './MenuBody.svelte'

  const asModalLink = useModalLink()
  const notHydrated = useJsOnly()
  const host = tryUseModals()

  const authorized = $derived(vault.authorized)
  const nickname = $derived(vault.profile.nickname)
  const avatarUrl = $derived(vault.profile.avatarUrl)
  const initial = $derived((nickname ?? '?').slice(0, 1).toUpperCase())

  /** адрес страницы входа с возвратом сюда (валидность next — в `userAuthRoute`) */
  const authHref = $derived(
    userAuthRoute.href({
      next: visibleAddress().url.pathname + visibleAddress().url.search,
    }),
  )

  /* ── меню: всплывашка на широкой ширине, модалка на узкой ─────────────── */
  // Порог — из настроек хоста, как у остальных потребителей (Select):
  // один источник истины. На сервере `matches=false` — рендерится широкая
  // ветка; узкий клиент после гидратации сам переключится на модальную.
  const narrow = createIsNarrow(() => host?.view.hostConfig.mobileBreakpoint ?? 768)
  const menuHref = userMenuRoute.href()

  let triggerEl = $state<HTMLElement | null>(null)
  let menuOpen = $state(false)
  let floatingId = $state<string | null>(null)
  let lastClosedAt = 0
  const menuNode = $derived(floatingId && host ? host.floating.container(floatingId) : undefined)

  function floatingOptions() {
    const rect = triggerEl?.getBoundingClientRect()
    if (!rect) return null
    return {
      rect: {
        left: rect.left, top: rect.top, right: rect.right,
        bottom: rect.bottom, width: rect.width, height: rect.height,
      },
      triggers: [triggerEl],
      listWidth: 'auto' as const,
      minWidth: 272,
      maxWidth: 300,
      label: 'Меню аккаунта',
      placement: { gap: 6, minSideSpace: 120, maxOverlayHeight: 420 },
      onClose: (reason: HostFloatingCloseReason) => {
        floatingId = null
        lastClosedAt = Date.now()
        if (reason === 'programmatic' || reason === 'transfer') return
        menuOpen = false
        if (reason === 'escape' || reason === 'history') triggerEl?.focus({ preventScroll: true })
      },
    }
  }

  function openMenu() {
    if (!host || floatingId !== null) return
    const options = floatingOptions()
    if (!options) return
    menuOpen = true
    floatingId = host.floating.open(options)
  }

  function closeMenu(returnFocus = true) {
    menuOpen = false
    if (host && floatingId !== null) {
      const id = floatingId
      floatingId = null
      host.floating.close(id)
    }
    if (returnFocus) triggerEl?.focus({ preventScroll: true })
  }

  function onTriggerClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (!host) return // нет хоста — обычная ссылка на страницу меню
    e.preventDefault()
    if (Date.now() - lastClosedAt < 250) return
    if (menuOpen) closeMenu(false)
    else openMenu()
  }

  /** Открылась любая модалка (например, профиль из меню) — всплывашку снимаем. */
  $effect(() => {
    if (menuOpen && host && host.view.chain.length > 0) closeMenu(false)
  })

  /** Всплывашка держится у кнопки при прокрутке и смене размеров. */
  $effect(() => {
    if (!menuOpen || !host || floatingId === null) return
    const update = () => {
      if (floatingId === null) return
      const options = floatingOptions()
      if (options) host.floating.update(floatingId, options)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  })

  /** Окно стало узким — дальше работает модальная ветка, всплывашку снимаем. */
  $effect(() => {
    if (narrow.matches && menuOpen) closeMenu(false)
  })

  /** Размонтировали открытой — не оставляем контейнер в хосте. */
  $effect(() => () => {
    if (host && floatingId !== null) host.floating.close(floatingId)
  })
</script>

{#if authorized}
  {#if narrow.matches}
    <!-- узкая ширина: аватар → меню-модалка; без JS — страница меню -->
    {@const link = asModalLink('user.menu')}
    <a
      {...link}
      data-testid="header-user"
      aria-label={nickname ? `Аккаунт: ${nickname}` : 'Аккаунт'}
      title={notHydrated() ? JS_ONLY_REASON : nickname ?? 'Аккаунт'}
      class="flex size-9 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground hover:bg-accent"
    >
      {#if avatarUrl}
        <img src={avatarUrl} alt="" class="h-auto w-full rounded-full" />
      {:else}
        {initial}
      {/if}
    </a>
  {:else}
    <!-- широкая ширина: аватар → всплывашка у кнопки, адрес не меняется;
         без JS — та же ссылка на страницу меню -->
    <a
      href={menuHref}
      bind:this={triggerEl}
      data-testid="header-user"
      aria-label={nickname ? `Аккаунт: ${nickname}` : 'Аккаунт'}
      title={notHydrated() ? JS_ONLY_REASON : nickname ?? 'Аккаунт'}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-controls={menuOpen && menuNode?.id ? menuNode.id : undefined}
      onclick={onTriggerClick}
      class="flex size-9 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground hover:bg-accent"
    >
      {#if avatarUrl}
        <img src={avatarUrl} alt="" class="h-auto w-full rounded-full" />
      {:else}
        {initial}
      {/if}
    </a>
    {#if menuOpen && menuNode}
      <Portal container={menuNode}>
        <div
          class="flex max-h-full flex-col overflow-auto rounded-[calc(var(--radius)+2px)] border border-border bg-card text-card-foreground shadow-[0_20px_45px_-12px_color-mix(in_oklab,var(--foreground)_30%,transparent),0_6px_16px_-8px_color-mix(in_oklab,var(--foreground)_20%,transparent)] outline-none"
          data-user-menu-popover=""
          aria-label="Меню аккаунта"
          tabindex="-1"
          {@attach (node) => node.focus({ preventScroll: true })}
        >
          <MenuBody variant="plain" class="p-3" onDone={() => closeMenu(false)} />
        </div>
      </Portal>
    {/if}
  {/if}
{:else}
  <!-- «Авторизация» → модалка входа; без JS — страница входа (href-фолбэк).
       Здесь `href` не избыточен: у маршрута тот же путь, но другой `next` —
       адрес возврата на текущую страницу, а не умолчание `null`. -->
  {@const link = asModalLink('user.auth', {}, { href: authHref })}
  <a
    {...link}
    data-testid="header-auth"
    class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
  >Авторизация</a>
{/if}
