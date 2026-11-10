<script lang="ts">
  /**
   * Кнопка пользователя в шапке.
   *
   * Меню авторизованного: на широкой ширине — `Floating` у кнопки
   * (адрес не меняется: этому меню URL не нужен), на узкой — модалка
   * `user.menu` (`?modal=user.menu`). Без JS обе ветки ведут на страницу
   * `/user/menu`: широкая ветка — обычная ссылка, клик перехватывается
   * только после гидратации; узкая — `asModalLink` с тем же фолбэком.
   * Гость: модалка входа (`user.auth`), без JS — страница входа.
   *
   * Читает исключительно единый реактивный `vault` (на SSR и до гидратации
   * `vault` прозрачно отдаёт `page.data.user`, в браузере — состояние RAM).
   */
  import type { Component } from 'svelte'
  import Button from '#components/ui/button/Button.svelte'
  import Floating from '#components/ui/floating/Floating.svelte'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#hooks/js-only.svelte.js'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { useIsMobile } from '#hooks/mobile.svelte.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import { userAuthRoute, userMenuRoute } from '../routes.js'
  import { vault } from '../vault.svelte.js'

  let MenuBodyComp = $state.raw<
    Component<{ variant?: UserSurfaceVariant; onDone?: () => void }> | null
  >(null)
  let menuBodyLoading: Promise<void> | null = null
  let menuBusy = $state(false)

  function loadMenuBody(): Promise<void> {
    if (MenuBodyComp) return Promise.resolve()
    if (!menuBodyLoading) {
      menuBodyLoading = import('./MenuBody.svelte')
        .then((mod) => {
          MenuBodyComp = mod.default
        })
        .catch(() => {
          // Сбой чанка не держим: следующий hover/клик попробует снова.
        })
        .finally(() => {
          menuBodyLoading = null
        })
    }
    return menuBodyLoading
  }

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
  // Порог — CSS `--mobile`, как у оболочки и модалки. На сервере
  // `matches=false`: рендерится широкая ветка; узкий клиент после эффекта
  // сам переключится на модальную.
  const narrow = useIsMobile()
  const menuHref = userMenuRoute.href()

  const menuPlacement = { gap: 6, minSideSpace: 120, maxOverlayHeight: 420 }

  let menuOpen = $state(false)

  async function onMenuChange(next: boolean) {
    if (!next) {
      menuOpen = false
      return
    }
    // Всплывашка не открывается, пока тело не доехало: иначе клик показывает скелетон.
    if (!MenuBodyComp) {
      menuBusy = true
      try {
        await loadMenuBody()
      } catch {
        // чанк не доехал — меню не открываем
      } finally {
        menuBusy = false
      }
    }
    if (MenuBodyComp) menuOpen = true
  }

  /** Открылась любая модалка (например, профиль из меню) — всплывашку снимаем. */
  $effect(() => {
    if (menuOpen && host && host.view.chain.length > 0) menuOpen = false
  })

  /** Окно стало узким — дальше работает модальная ветка, всплывашку снимаем. */
  $effect(() => {
    if (narrow.matches && menuOpen) menuOpen = false
  })
</script>

{#if authorized}
  <div class="flex items-center gap-1">
    <Button
      {...asModalLink('user.sessions')}
      variant="ghost"
      size="sm"
      data-testid="header-sessions-open"
    >Сессии</Button>
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
    <Floating
      open={menuOpen}
      label="Меню аккаунта"
      minWidth={272}
      maxWidth={300}
      placement={menuPlacement}
      title="Меню аккаунта"
      autofocus
      onOpenChange={onMenuChange}
    >
      {#snippet trigger(api)}
        <a
          href={menuHref}
          {@attach (node) => {
            api.ref(node)
            return () => api.ref(null)
          }}
          data-testid="header-user"
          aria-label={nickname ? `Аккаунт: ${nickname}` : 'Аккаунт'}
          title={notHydrated() ? JS_ONLY_REASON : nickname ?? 'Аккаунт'}
          aria-busy={menuBusy ? 'true' : undefined}
          data-pending={menuBusy ? '' : undefined}
          aria-haspopup={api.popup}
          aria-expanded={api.expanded}
          aria-controls={api.controls}
          onpointerenter={loadMenuBody}
          onfocusin={loadMenuBody}
          onclick={api.toggle}
          class="flex size-9 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground hover:bg-accent"
        >
          {#if avatarUrl}
            <img src={avatarUrl} alt="" class="h-auto w-full rounded-full" />
          {:else}
            {initial}
          {/if}
        </a>
      {/snippet}
        {#snippet render()}
          <div data-user-menu-popover="">
            {#if MenuBodyComp}
              <MenuBodyComp variant="plain" onDone={() => (menuOpen = false)} />
            {/if}
          </div>
        {/snippet}
      </Floating>
  {/if}
  </div>
{:else}
  <!-- «Авторизация» → модалка входа; без JS — страница входа (href-фолбэк).
       Здесь `href` не избыточен: у маршрута тот же путь, но другой `next` —
       адрес возврата на текущую страницу, а не умолчание `null`. -->
  {@const link = asModalLink('user.auth', {}, { href: authHref })}
  <Button
    {...link}
    variant="outline"
    size="sm"
    data-testid="header-auth"
  >Авторизация</Button>
{/if}
