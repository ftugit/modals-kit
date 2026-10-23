<script lang="ts">
  // Каркас сайта: AppShell (CollapsingHeader, Sidebar, Main scroller) и
  // базовые слоты шапки и сайдбара. При переходах между страницами шапка и
  // сайдбар не пересоздаются (C2). Кнопки шапки страница добавляет сама —
  // `useHeaderSlot` в своём компоненте; уходит страница — уходят и они.
  //
  // Модальная система живёт ЗДЕСЬ, над AppShell (решение владельца, ход 253):
  // кнопки шапки — потомки хоста и открывают модалки (`useModals`). Ветка
  // `(modals-demo)` вкладывает СВОЙ хост (demoScope) в этот: чужие имена
  // каждый хост пропускает (`foreignNames: 'skip'`) — страница /modals
  // показывает и глобальные, и демо-модалки из одной цепочки адреса.
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { page } from '$app/state'
  import './auth-modals'
  import { globalScope } from '#lib/modals/index.js'
  import ModalSystem from './ModalSystem.svelte'
  import { AppShell, useHeaderSlot, useSidebarSlot } from '#lib/components/shell/index.js'
  import {
    LogoSlot,
    NavSlot,
    ThemeToggleSlot,
    PageTitleSlot,
    SiteFooter,
  } from '#lib/components/header/index.js'
  import {
    SidebarNav,
    SidebarUser,
    SidebarFooter,
  } from '#lib/components/sidebar/index.js'
  import UserMenu from '#content/user/ui/UserMenu.svelte'
  import { vault } from '#content/user/vault.svelte.js'

  let { children, data } = $props()

  // Метаданные сессии из SSR: синхронизируем на старте вкладки и строго при
  // реальном перезапуске серверного `+layout.server.ts` (`data.authStamp`),
  // чтобы кэш layout'а на клиентских переходах не затирал живой RAM, но свежий
  // ответ сервера (включая `null` при отзыве сессии) применялся немедленно.
  $effect.pre(() => {
    vault.syncServer(data.user, data.authStamp)
  })

  // Базовые слоты шапки по умолчанию
  // Раскладка шапки (решение владельца): верхний ряд — логотип, заголовок и
  // справа ТОЛЬКО профиль; пункты меню — в среднем (липком) ряду слева,
  // переключатель темы — там же справа. Средний ряд виден всегда, верхний
  // при скролле прячется (CollapsingHeader).
  useHeaderSlot('top.start', logoSnippet)
  useHeaderSlot('top.center', titleSnippet)
  useHeaderSlot('middle.start', navSnippet)
  useHeaderSlot('middle.end', themeSnippet)
  useHeaderSlot('top.end', userSnippet)

  // Базовые слоты 3-зонного сайдбара
  useSidebarSlot('top', sidebarTopSnippet)
  useSidebarSlot('middle', sidebarNavSnippet)
  useSidebarSlot('bottom', sidebarBottomSnippet)

  const SOURCES = ['url', 'local'] as const

  // Ветка демо модалок владеет цепочкой своей страницы: там наш хост молчит
  // о чужих именах (их покажет её хост); на остальных страницах мы одни,
  // и неизвестное имя — честная карточка ошибки. Решает ПАПКА адреса —
  // вложенный хост существует только у /modals.
  const foreignNames = $derived(visibleAddress().url.pathname.startsWith('/modals') ? ('skip' as const) : ('error' as const))
</script>

<ModalSystem scope={globalScope} sources={() => SOURCES} {foreignNames}>
  <AppShell prefs={data.shell} footer={footerSnippet}>
    {@render children()}
  </AppShell>
</ModalSystem>

{#snippet footerSnippet()}
  <SiteFooter />
{/snippet}

{#snippet logoSnippet()}
  <LogoSlot />
{/snippet}

{#snippet titleSnippet()}
  <PageTitleSlot />
{/snippet}

{#snippet navSnippet()}
  <NavSlot />
{/snippet}

{#snippet themeSnippet()}
  <ThemeToggleSlot />
{/snippet}

{#snippet userSnippet()}
  <UserMenu />
{/snippet}

{#snippet sidebarTopSnippet()}
  <SidebarUser />
{/snippet}

{#snippet sidebarNavSnippet()}
  <SidebarNav />
{/snippet}

{#snippet sidebarBottomSnippet()}
  <SidebarFooter />
{/snippet}
