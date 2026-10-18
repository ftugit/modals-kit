<script lang="ts">
  // Каркас сайта: AppShell (CollapsingHeader, Sidebar, Main scroller) и
  // базовые слоты шапки и сайдбара. Живёт ВЫШЕ модальных систем веток
  // `(app)` и `(modals-demo)`: при переходах между страницами шапка и
  // сайдбар не пересоздаются (C2). Кнопки шапки страница добавляет сама —
  // `useHeaderSlot` в своём компоненте; уходит страница — уходят и они.
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
  import { hydrateVault, vault } from '#content/user/vault.svelte.js'

  let { children, data } = $props()

  // RAM-копия токена из кук (сервер отдал в данных, сам JS куки не читает).
  // Только если vault пуст: свежее продление в этой вкладке важнее серверного.
  $effect(() => {
    if (!vault.access && data.user) hydrateVault(data.user)
  })

  // Базовые слоты шапки по умолчанию
  useHeaderSlot('top.start', logoSnippet)
  useHeaderSlot('top.center', titleSnippet)
  useHeaderSlot('top.end', navSnippet)
  useHeaderSlot('top.end', themeSnippet)
  useHeaderSlot('top.end', userSnippet)

  // Базовые слоты 3-зонного сайдбара
  useSidebarSlot('top', sidebarTopSnippet)
  useSidebarSlot('middle', sidebarNavSnippet)
  useSidebarSlot('bottom', sidebarBottomSnippet)
</script>

<AppShell prefs={data.shell}>
  {@render children()}
  <SiteFooter />
</AppShell>

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
  <UserMenu server={data.user} />
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
