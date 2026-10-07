<script lang="ts">
  // Корневой layout: модальная система + AppShell (CollapsingHeader, Sidebar, Main scroller).
  import favicon from '$lib/assets/favicon.svg'
  import { untrack } from 'svelte'
  import { page } from '$app/state'
  import {
    createModals,
    globalScope,
    localStorageChain,
    memoryStorage,
    urlStorage,
    type ChainStorage,
    type ModalRegistry,
  } from '$lib/modals'
  import { svelteKitCore } from '$lib/modals/cores/sveltekit'
  import { ModalHost } from '$lib/modals/svelte'
  import { BackdropCloseIcon, ModalError, Skeleton } from '$lib/ui/modals'
  import { demoScope } from './modals/modals'
  import { demoSources } from './modals/sources.svelte'
  import {
    setPageContext,
    AppShell,
    PageHead,
    useHeaderSlot,
    useSidebarSlot,
  } from '$lib/shell'
  import {
    LogoSlot,
    NavSlot,
    ThemeToggleSlot,
    PageTitleSlot,
    SiteFooter,
  } from '$lib/components/header'
  import {
    SidebarNav,
    SidebarUser,
    SidebarFooter,
  } from '$lib/components/sidebar'
  import 'virtual:uno.css'
  import '../app.css'

  let { children } = $props()

  // Инициализация контекста страницы
  setPageContext({ title: 'dd modals', titleSeparator: ' · ' })

  // Базовые слоты шапки по умолчанию
  useHeaderSlot('top.start', logoSnippet)
  useHeaderSlot('top.center', titleSnippet)
  useHeaderSlot('top.end', navSnippet)
  useHeaderSlot('top.end', themeSnippet)

  // Базовые слоты 3-зонного сайдбара
  useSidebarSlot('top', sidebarTopSnippet)
  useSidebarSlot('middle', sidebarNavSnippet)
  useSidebarSlot('bottom', sidebarBottomSnippet)

  /** Роут → область видимости модалок этого роута. Прочие — globalScope. */
  const ROUTE_SCOPES: Record<string, ModalRegistry> = { '/modals': demoScope }

  /**
   * Роуты с СОБСТВЕННЫМИ модальными системами: /cycle — демо ручной сборки
   * ядра, /spike — песочница модели истории.
   */
  const OWN_SYSTEM = new Set(['/cycle', '/spike'])

  /** Набор источников под выбранные имена. */
  function sourcesFor(names: string[]): Record<string, ChainStorage> {
    const map: Record<string, ChainStorage> = {}
    if (names.includes('url')) map.url = urlStorage()
    if (names.includes('local')) {
      map.local = localStorageChain(
        typeof localStorage !== 'undefined'
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      )
    }
    if (names.includes('memory')) map.memory = memoryStorage()
    return map
  }

  const scope = $derived(page.url.pathname.startsWith('/modals') || page.route.id === '/modals' ? demoScope : (ROUTE_SCOPES[page.route.id ?? ''] ?? globalScope))

  const initial = untrack(() => ({ names: [...demoSources.list], lookup: scope.lookup }))
  const core = svelteKitCore(sourcesFor(initial.names), { lookup: initial.lookup })
  const modals = createModals(core, { tailCount: 3, maxHeight: '80vh' })

  let appliedNames = initial.names.join()
  let appliedLookup = initial.lookup
  $effect(() => {
    const names = demoSources.list
    const nextLookup = scope.lookup
    const key = names.join()
    if (key === appliedNames && nextLookup === appliedLookup) return
    appliedNames = key
    appliedLookup = nextLookup
    untrack(() => core.reconfigure({ sources: sourcesFor(names), lookup: nextLookup }))
  })
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<PageHead defaultTitle="dd modals" />

{#if OWN_SYSTEM.has(page.route.id ?? '')}
  {@render children()}
{:else}
  <ModalHost
    {modals}
    scope={scope}
    closeIcon
    backdropClick="top"
    tailCount={3}
    maxHeight="80vh"
    mobileBreakpoint={768}
    defaultMobile="bottom"
  >
    {#snippet skeleton()}
      <Skeleton />
    {/snippet}
    {#snippet error(message, hint)}
      <ModalError {message} {hint} />
    {/snippet}
    {#snippet closeIconSlot()}
      <BackdropCloseIcon />
    {/snippet}

    <AppShell>
      {@render children()}
      <SiteFooter />
    </AppShell>
  </ModalHost>
{/if}

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

{#snippet sidebarTopSnippet()}
  <SidebarUser />
{/snippet}

{#snippet sidebarNavSnippet()}
  <SidebarNav />
{/snippet}

{#snippet sidebarBottomSnippet()}
  <SidebarFooter />
{/snippet}
