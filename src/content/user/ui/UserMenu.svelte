<script lang="ts">
  /**
   * Кнопка пользователя в шапке (вариант 1).
   * С JS открывает модалку (`user.menu` / `user.auth`), без JS ведёт на
   * страницу `/user/menu` / `/user/auth`.
   *
   * В браузере после инициализации читает реактивный RAM `vault` через
   * `readUser(server)` — вход, смена профиля и выход отражаются мгновенно.
   */
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { useModalLink } from '#lib/components/links/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { readUser } from '../vault.svelte.js'

  interface Props {
    /** Снимок входа с сервера (SSR): до гидратации vault пуст. */
    server?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
  }

  let { server = null }: Props = $props()

  const asModalLink = useModalLink()
  const notHydrated = useJsOnly()

  const currentUser = $derived(readUser(server))
  const authorized = $derived(currentUser !== null)
  const nickname = $derived(currentUser?.prof.nickname ?? null)
  const avatarUrl = $derived(currentUser?.prof.avatarUrl ?? null)
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
