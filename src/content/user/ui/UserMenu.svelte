<script lang="ts">
  /**
   * Кнопка пользователя в шапке (вариант 1). Хост модалок живёт в ветке
   * `(app)` НИЖЕ шапки (`(site)` рендерит AppShell раньше `ModalSystem`), поэтому
   * из шапки модальная механика недоступна изнутри компонента — ссылка на
   * модалку (`user.menu`), без JS — на страницу меню `/user/menu` (решение
   * владельца, ход 261: там выход, тело — тот же `MenuBody`).
   *
   * Аватар: круглый блок под размер аватара; картинка во всю ширину блока,
   * высота auto, тоже круглая; пока её нет или она грузится — виден заполнитель
   * (инициал на приглушённом фоне).
   */
  import { page } from '$app/state'
  import { useModalLink } from '#lib/components/links/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { vault } from '../vault.svelte.js'

  interface Props {
    /** Снимок входа с сервера (SSR): до гидратации vault пуст. */
    server?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
  }

  let { server = null }: Props = $props()

  const asModalLink = useModalLink()
  const notHydrated = useJsOnly()

  const authorized = $derived(vault.principal !== null || server !== null)
  const nickname = $derived(vault.profile.nickname ?? server?.prof.nickname ?? null)
  const avatarUrl = $derived(vault.profile.avatarUrl ?? server?.prof.avatarUrl ?? null)
  const initial = $derived((nickname ?? '?').slice(0, 1).toUpperCase())

  /** адрес страницы входа с возвратом сюда (валидность next — на сервере) */
  const authHref = $derived(`/user/auth?next=${encodeURIComponent(page.url.pathname + page.url.search)}`)
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
