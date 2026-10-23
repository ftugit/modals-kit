<script lang="ts">
  /**
   * Кнопка пользователя в шапке.
   * С JS открывает модалку (`user.menu` / `user.auth`), без JS ведёт на
   * страницу `/user/menu` / `/user/auth`.
   *
   * Читает исключительно единый реактивный `vault` (на SSR и до гидратации
   * `vault` прозрачно отдаёт `page.data.user`, в браузере — состояние RAM).
   */
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { useModalLink } from '#lib/components/links/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { vault } from '../vault.svelte.js'

  const asModalLink = useModalLink()
  const notHydrated = useJsOnly()

  const authorized = $derived(vault.authorized)
  const nickname = $derived(vault.profile.nickname)
  const avatarUrl = $derived(vault.profile.avatarUrl)
  const initial = $derived((nickname ?? '?').slice(0, 1).toUpperCase())

  /** адрес страницы входа с возвратом сюда (валидность next — на сервере) */
  const authHref = $derived(
    `/user/auth?next=${encodeURIComponent(visibleAddress().url.pathname + visibleAddress().url.search)}`,
  )
</script>

{#if authorized}
  <!-- аватар → меню-модалка; без JS — страница меню с выходом -->
  {@const link = asModalLink('user.menu', {}, { href: '/user/menu' })}
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
  <!-- «Авторизация» → модалка входа; без JS — страница входа (href-фолбэк) -->
  {@const link = asModalLink('user.auth', {}, { href: authHref })}
  <a
    {...link}
    data-testid="header-auth"
    class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
  >Авторизация</a>
{/if}
