<script lang="ts">
  /**
   * Кнопка пользователя в шапке (вариант 1). Хост модалок живёт в ветке
   * `(app)` НИЖЕ шапки (`(site)` рендерит AppShell раньше `ModalSystem`),
   * поэтому из шапки модальная механика недоступна — здесь честный фолбэк:
   * обычные ссылки на страницу `/user/auth` (работают и без JS). Внутри
   * модального контекста тот же компонент открыл бы `user.auth`/`user.menu`
   * модалкой (`tryUseModals`).
   *
   * При входе вместо кнопки — аватар/инициал; пока профильного экрана нет,
   * он ведёт на ту же страницу, где есть выход.
   */
  import { page } from '$app/state'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { useModalLink } from '#lib/components/links/index.js'
  import { useJsOnly, JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
  import { vault } from '../vault.svelte.js'

  interface Props {
    /** Снимок входа с сервера (SSR): до гидратации vault пуст. */
    server?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
  }

  let { server = null }: Props = $props()

  const m = tryUseModals()
  // useModalLink() требует контекст хоста — зовём только когда он есть
  const asModalLink = m ? useModalLink() : null
  const notHydrated = useJsOnly()

  const authorized = $derived(vault.principal !== null || server !== null)
  const nickname = $derived(vault.profile.nickname ?? server?.prof.nickname ?? null)
  const avatarUrl = $derived(vault.profile.avatarUrl ?? server?.prof.avatarUrl ?? null)
  const initial = $derived((nickname ?? '?').slice(0, 1).toUpperCase())

  /** адрес страницы входа с возвратом сюда (валидность next — на сервере) */
  const authHref = $derived(`/user/auth?next=${encodeURIComponent(page.url.pathname + page.url.search)}`)
</script>

{#if authorized}
  <a
    href={authHref}
    aria-label={nickname ? `Аккаунт: ${nickname}` : 'Аккаунт'}
    title={notHydrated() ? JS_ONLY_REASON : nickname ?? 'Аккаунт'}
    class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border text-sm font-semibold hover:bg-accent"
  >
    {#if avatarUrl}
      <img src={avatarUrl} alt="" class="h-full w-full object-cover" />
    {:else}
      {initial}
    {/if}
  </a>
{:else if asModalLink}
  <!-- внутри модального хоста — модальная ссылка (адресуемая модалка) -->
  {@const link = asModalLink('user.auth', {}, { href: authHref })}
  <button {...link} class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">Авторизация</button>
{:else}
  <!-- шапка: host ниже по дереву — фолбэк-ссылка на страницу входа -->
  <a
    href={authHref}
    data-testid="header-auth"
    class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
  >Авторизация</a>
{/if}
