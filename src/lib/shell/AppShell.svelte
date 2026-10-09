<script lang="ts">
  // Каркас приложения: CollapsingHeader (3 ряда) + 3-зонный Sidebar + Main scroller.
  import { onMount, type Snippet } from 'svelte'
  import { cn } from '$lib/ui/cn'
  import { BACKDROP_UTILS } from '$lib/modals/svelte/classes'
  import { usePage, sidebarHasSlots } from './page.svelte'
  import { setShellContext } from './shell.svelte'
  import CollapsingHeader from './CollapsingHeader.svelte'
  import { createDrawer, labelKeyHandler } from './use-drawer.svelte'

  let { children }: { children: Snippet } = $props()

  const shell = setShellContext()
  const page = usePage()

  let inputRef = $state<HTMLInputElement>()
  let asideRef = $state<HTMLElement>()
  let mainRef = $state<HTMLElement>()

  let isNarrow = $state(false)

  onMount(() => {
    shell.setMain(mainRef)
    const mq = window.matchMedia('(max-width: 1023px)')
    const update = () => (isNarrow = mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  const hasSidebar = $derived(sidebarHasSlots(page.sidebar))
  const drawer = createDrawer({
    input: () => inputRef,
    panel: () => asideRef,
    isNarrow: () => isNarrow,
  })
</script>

<div
  data-fe-shell
  data-dock={shell.dock}
  data-side={shell.side}
  class="flex h-screen w-full flex-col overflow-clip bg-background text-foreground"
>
  <!-- Состояние drawer'а — скрытый checkbox (работает без JS) -->
  <input
    type="checkbox"
    id="fe-sidebar"
    class="absolute size-px -m-px overflow-hidden border-0 p-0 whitespace-nowrap opacity-0 pointer-events-none [clip:rect(0_0_0_0)]"
    data-fe-sidebar-state=""
    aria-hidden="true"
    tabindex="-1"
    bind:this={inputRef}
  />

  <!-- 3-рядная сворачиваемая шапка -->
  <CollapsingHeader
    rows={page.header}
    dock={shell.dock}
    scrollContainer={mainRef}
    snap={shell.snap}
    onProgress={(p) => shell.setProgress(p)}
    leading={(row) => (row === 'top' && hasSidebar ? menuButton : undefined)}
    class={shell.dock === 'top' ? 'order-first' : 'order-last'}
  />

  <!--
    Рабочая зона: Sidebar + Main scroller.
    `max-lg:z-40` делает строку контекстом наложения на узком экране: фон
    drawer'а (z-200) и панель (z-210) считаются внутри него и целиком лежат
    выше шапки (z-30), но ниже модальной системы (фон 200 / сцена 210 —
    они в корневом контексте). Без этого фон drawer'а не закрывал шапку.
  -->
  <div class="relative flex min-h-0 flex-1 max-lg:z-40">
    <!-- 3-ЗОННЫЙ САЙДБАР: TOP (safe zone), MIDDLE (scrollable), BOTTOM (safe zone) -->
    <aside
      id="fe-sidebar-panel"
      bind:this={asideRef}
      data-fe-sidebar-panel=""
      class={cn(
        'flex w-[260px] shrink-0 flex-col border-border/70 bg-background',
        // Мобильный drawer: панель фиксируется и живёт над фоном (z-200).
        'max-lg:fixed max-lg:top-0 max-lg:bottom-0 max-lg:z-210 max-lg:transition-transform max-lg:duration-300 max-lg:ease-[cubic-bezier(0.32,0.72,0,1)] max-lg:shadow-[0_10px_40px_-10px_color-mix(in_oklab,var(--foreground)_35%,transparent)]',
        shell.side === 'left'
          ? 'order-first border-r max-lg:left-0 max-lg:-translate-x-full'
          : 'order-last border-l max-lg:right-0 max-lg:translate-x-full',
        // Открытие без JS: состояние несёт скрытый checkbox, а признак
        // «открыто» читает :has() у корня оболочки — того же, по которому
        // раньше работали правила из app.css.
        '[[data-fe-shell]:has(#fe-sidebar:checked)_&]:translate-x-0',
        hasSidebar ? '' : 'hidden',
      )}
    >
      <!-- Мобильный заголовок панели с кнопкой закрытия -->
      <div class="flex items-center justify-between border-b border-border/50 px-4 py-3 lg:hidden shrink-0">
        <span class="text-sm font-semibold">Панель</span>
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <label
          for="fe-sidebar"
          role="button"
          tabindex="0"
          data-fe-sidebar-close=""
          aria-label="Закрыть панель"
          class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer"
          onkeydown={labelKeyHandler}
          onclick={(e) => {
            e.preventDefault()
            drawer.close()
          }}
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </label>
      </div>

      <!-- ЗОНА 1: TOP (Safe Zone, shrink-0, фикс сверху) -->
      {#if page.sidebar.top.length > 0}
        <div class="flex flex-col gap-2 shrink-0 border-b border-border/50 p-3" data-sidebar-zone="top">
          {#each page.sidebar.top as item (item.id)}
            {@render item.snippet()}
          {/each}
        </div>
      {/if}

      <!-- ЗОНА 2: MIDDLE (Scrollable Zone, flex-1 min-h-0 overflow-y-auto) -->
      <div class="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2" data-sidebar-zone="middle">
        {#each page.sidebar.middle as item (item.id)}
          {@render item.snippet()}
        {/each}
      </div>

      <!-- ЗОНА 3: BOTTOM (Safe Zone, shrink-0, фикс снизу) -->
      {#if page.sidebar.bottom.length > 0}
        <div class="flex flex-col gap-2 shrink-0 border-t border-border/50 p-3" data-sidebar-zone="bottom">
          {#each page.sidebar.bottom as item (item.id)}
            {@render item.snippet()}
          {/each}
        </div>
      {/if}
    </aside>

    <!-- Основная рабочая область (скроллер) -->
    <main
      bind:this={mainRef}
      data-fe-scroll="owner"
      tabindex="-1"
      class="flex min-w-0 flex-1 flex-col overflow-y-auto outline-none"
    >
      {@render children()}
    </main>

    <!--
      Мобильная подложка (Backdrop) для Drawer'а.
      Набор классов — тот же, что у фона модальной системы (BACKDROP_UTILS):
      fixed inset-0, z-200, затемнение 60% и blur(2px). Поэтому подложка
      закрывает и шапку, а не только рабочую зону, и выглядит как фон модалок.
      Маркер modal-backdrop не берём: по нему browser-тесты считают фон стопки.
    -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <label
      for="fe-sidebar"
      data-fe-sidebar-backdrop=""
      aria-label="Закрыть подложку"
      class={cn(
        'lg:hidden',
        BACKDROP_UTILS,
        'opacity-0 pointer-events-none',
        '[[data-fe-shell]:has(#fe-sidebar:checked)_&]:opacity-100',
        '[[data-fe-shell]:has(#fe-sidebar:checked)_&]:pointer-events-auto',
      )}
      onclick={(e) => {
        e.preventDefault()
        drawer.close()
      }}
    ></label>
  </div>
</div>

{#snippet menuButton()}
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <label
    for="fe-sidebar"
    role="button"
    tabindex="0"
    aria-controls="fe-sidebar-panel"
    aria-label="Открыть панель"
    class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer lg:hidden"
    onkeydown={labelKeyHandler}
  >
    <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  </label>
{/snippet}
