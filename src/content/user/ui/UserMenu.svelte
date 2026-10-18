<script lang="ts">
  /**
   * UserMenu — точка входа авторизации на сайте (вариант 1, решение владельца).
   * Один компонент, разница только в callback: с JS «Авторизация» открывает
   * адресную модалку (`useModalLink`), без JS та же ссылка ведёт на роут
   * `/user/auth?next=«текущий адрес с параметрами»`; после успеха виджет
   * вернёт на `next` (роут) или закроет модалку. Авторизованным — иконка
   * (аватар из vault, иначе инициал), под ней меню-модалка.
   *
   * Состояние — из vault (RAM-копия токена): после входа/выхода в любой
   * вкладке все потребители перерисовываются сами, перезапуск не нужен.
   * До гидратации (SSR/no-JS) показ по серверным данным страницы (`server`),
   * чтобы иконка не мигала «Авторизация» у залогиненного.
   */
  import { page } from '$app/state'
  import { useModalLink } from '#lib/components/links/index.js'
  import { useModals } from '#lib/modals/svelte/index.js'
  import { vault } from '../vault.svelte.js'

  interface Props {
    /** Серверный факт входа (данные layout): иконка без JS и до гидратации. */
    server?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
  }

  let { server = null }: Props = $props()

  const asModalLink = useModalLink()
  const m = useModals()

  const here = $derived(page.url.pathname + page.url.search)
  const authLink = $derived(asModalLink('user.auth', {}, { href: `/user/auth?next=${encodeURIComponent(here)}` }))
  const menuLink = $derived(asModalLink('user.menu', {}, { href: `/user/auth?next=${encodeURIComponent(here)}` }))

  const authorized = $derived(vault.principal !== null || server !== null)
  const avatarUrl = $derived(vault.profile.avatarUrl ?? server?.prof.avatarUrl ?? null)
  const initial = $derived((vault.profile.nickname ?? server?.prof.nickname ?? '?').slice(0, 1).toUpperCase())
</script>

{#if authorized}
  <button
    {...menuLink}
    class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-accent text-sm font-semibold text-accent-foreground"
    aria-label="Меню пользователя"
  >
    {#if avatarUrl}
      <img src={avatarUrl} alt="" class="h-9 w-9 rounded-full object-cover" />
    {:else}
      {initial}
    {/if}
  </button>
{:else}
  <a
    {...authLink}
    class="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
  >Авторизация</a>
{/if}
