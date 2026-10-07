<script lang="ts" module>
  export interface FloatingMenuItem {
    label: string
    hint?: string
    disabled?: boolean
    onSelect?: () => void
  }
</script>

<script lang="ts">
  /**
   * Демонстрационное всплывающее меню — ВТОРОЙ потребитель `host.floating`.
   *
   * Решение D22: абстракция проверяется вторым потребителем. До сих пор
   * host-owned оверлеями пользовался только `Select`, поэтому было неясно,
   * что в его коде от общей механики, а что от самого select'а. Меню берёт
   * ровно те же вызовы — `open/update/close/container` — и ничего больше:
   *
   *   • геометрию считает хост (нам достаточно отдать rect триггера);
   *   • Escape, клик мимо и порядок закрытия — тоже хост;
   *   • на узком экране `modalOnNarrow` превращает меню в модальный лист.
   *
   * `aria-controls` на кнопке обязателен: по нему ловушка фокуса модалки
   * признаёт портированное меню своим (решение D31).
   */
  import { Portal } from '@ark-ui/svelte/portal'
  import { tryUseModals, type HostFloatingCloseReason } from '$lib/modals/svelte'
  import { cn } from '$lib/ui/cn'
  import { modalButtonVariants } from '$lib/ui/modals'
  import type { MobileAnchor } from '$lib/modals'

  interface Props {
    label: string
    items: FloatingMenuItem[]
    /**
     * Направление листа. Не задано — наследуется у активной модалки,
     * а если её нет — берётся умолчание хоста.
     */
    mobile?: MobileAnchor
    /**
     * Участвует ли меню в мобильном режиме. Не задано — следуем умолчанию
     * хоста (`floatingMobile`, иначе `defaultMobile`). `false` — всегда
     * выпадашка, сколько бы ни было узко; `true` — всегда лист.
     */
    sheetOnNarrow?: boolean
    class?: string
  }
  let { label, items, mobile, sheetOnNarrow, class: cls }: Props = $props()

  const host = tryUseModals()

  let buttonEl = $state<HTMLButtonElement | null>(null)
  let open = $state(false)
  let activeIndex = $state(0)
  let floatingId = $state<string | null>(null)
  let lastClosedAt = 0

  const menuNode = $derived(floatingId && host ? host.floating.container(floatingId) : undefined)
  const enabled = $derived(items.filter((i) => !i.disabled))

  function floatingOptions() {
    const rect = buttonEl?.getBoundingClientRect()
    if (!rect) return null
    return {
      rect: {
        left: rect.left, top: rect.top, right: rect.right,
        bottom: rect.bottom, width: rect.width, height: rect.height,
      },
      triggers: [buttonEl],
      listWidth: 'auto' as const,
      minWidth: Math.max(rect.width, 180),
      maxWidth: 280,
      modalOnNarrow: sheetOnNarrow,
      mobile,
      label,
      placement: { gap: 6, minSideSpace: 120, maxOverlayHeight: 320 },
      onClose: (reason: HostFloatingCloseReason) => {
        floatingId = null
        lastClosedAt = Date.now()
        if (reason === 'programmatic' || reason === 'transfer') return
        open = false
        if (reason === 'escape') buttonEl?.focus({ preventScroll: true })
      },
    }
  }

  function openMenu() {
    if (!host || floatingId !== null) return
    const options = floatingOptions()
    if (!options) return
    activeIndex = 0
    open = true
    floatingId = host.floating.open(options)
  }

  function closeMenu(returnFocus = true) {
    open = false
    if (host && floatingId !== null) {
      const id = floatingId
      floatingId = null
      host.floating.close(id)
    }
    if (returnFocus) buttonEl?.focus({ preventScroll: true })
  }

  function handleButtonClick() {
    if (Date.now() - lastClosedAt < 250) return
    if (open) closeMenu(false)
    else openMenu()
  }

  function choose(item: FloatingMenuItem) {
    if (item.disabled) return
    item.onSelect?.()
    closeMenu()
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    openMenu()
    if (event.key === 'ArrowUp') activeIndex = Math.max(0, enabled.length - 1)
  }

  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeIndex = (activeIndex + 1) % Math.max(1, enabled.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex = (activeIndex - 1 + enabled.length) % Math.max(1, enabled.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const item = enabled[activeIndex]
      if (item) choose(item)
    } else if (event.key === 'Home') {
      event.preventDefault(); activeIndex = 0
    } else if (event.key === 'End') {
      event.preventDefault(); activeIndex = Math.max(0, enabled.length - 1)
    }
  }

  /** Меню держится у кнопки при прокрутке и смене размеров — как у select. */
  $effect(() => {
    if (!open || !host || floatingId === null) return
    const update = () => {
      if (floatingId === null) return
      const options = floatingOptions()
      if (options) host.floating.update(floatingId, options)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  })

  /** Размонтировали открытым — не оставляем контейнер в хосте. */
  $effect(() => () => {
    if (host && floatingId !== null) host.floating.close(floatingId)
  })
</script>

<button
  bind:this={buttonEl}
  type="button"
  class={cn(modalButtonVariants({ variant: 'quiet' }), cls)}
  data-modal-btn=""
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={open && menuNode?.id ? menuNode.id : undefined}
  onclick={handleButtonClick}
  onkeydown={onTriggerKeydown}
>
  {label}
</button>

{#if open && menuNode}
  <Portal container={menuNode}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!--
      Оформление — утилиты, а не прежний блочный стиль: лист отличается от
      выпадашки только ветками `group-data-[…]/sheet` (признак режима хост
      кладёт на свой контейнер вместе с `group/sheet`), разметка одна.
    -->
    <div
      class={cn(
        'flex max-h-full flex-col gap-0.5 overflow-auto rounded-[calc(var(--radius)+2px)] border border-border bg-card p-1.5 text-card-foreground outline-none',
        'shadow-[0_20px_45px_-12px_color-mix(in_oklab,var(--foreground)_30%,transparent),0_6px_16px_-8px_color-mix(in_oklab,var(--foreground)_20%,transparent)]',
        // Лист: во всю высоту, шапка, цели покрупнее, скругление только
        // внешних углов (их задаёт хост через `data-mobile-anchor`).
        'group-data-[layout=sheet]/sheet:h-full group-data-[layout=sheet]/sheet:gap-0 group-data-[layout=sheet]/sheet:rounded-[16px] group-data-[layout=sheet]/sheet:p-0',
        'group-data-[layout=sheet]/sheet:pb-[max(8px,env(safe-area-inset-bottom))]',
        'group-data-[layout=sheet]/sheet:shadow-[0_-10px_40px_-10px_color-mix(in_oklab,var(--foreground)_30%,transparent)]',
        'group-data-[mobile-anchor=bottom]/sheet:rounded-b-none group-data-[mobile-anchor=bottom]/sheet:border-b-0',
        'group-data-[mobile-anchor=top]/sheet:rounded-t-none group-data-[mobile-anchor=top]/sheet:border-t-0',
        'group-data-[mobile-anchor=left]/sheet:rounded-l-none group-data-[mobile-anchor=left]/sheet:border-l-0',
        'group-data-[mobile-anchor=right]/sheet:rounded-r-none group-data-[mobile-anchor=right]/sheet:border-r-0',
      )}
      data-floating-menu=""
      role="menu"
      tabindex="-1"
      aria-label={label}
      onkeydown={onMenuKeydown}
      {@attach (node) => node.focus({ preventScroll: true })}
    >
      <!--
        Шапка листа. На десктопе скрыта — ровно как у select: признак
        режима приходит от хоста через `data-layout`, разметка одна.
      -->
      <!-- Шапка нужна только листу. -->
      <div
        class="hidden group-data-[layout=sheet]/sheet:flex group-data-[layout=sheet]/sheet:min-h-14 group-data-[layout=sheet]/sheet:items-center group-data-[layout=sheet]/sheet:justify-between group-data-[layout=sheet]/sheet:gap-2 group-data-[layout=sheet]/sheet:border-b group-data-[layout=sheet]/sheet:border-border group-data-[layout=sheet]/sheet:px-4"
        data-floating-menu-head=""
      >
        <span class="text-[0.95rem] font-semibold" data-floating-menu-title="">{label}</span>
        <button
          type="button"
          class="inline-flex size-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent hover:bg-accent"
          data-floating-menu-close=""
          aria-label="Закрыть меню"
          onclick={() => closeMenu()}
        >✕</button>
      </div>
      {#each items as item, i (item.label)}
        {@const index = enabled.indexOf(item)}
        <button
          type="button"
          role="menuitem"
          class={cn(
            'flex w-full items-baseline justify-between gap-3 rounded-[7px] border-0 bg-transparent px-2.5 py-2 text-left text-inherit',
            'cursor-pointer data-[active]:bg-accent disabled:cursor-not-allowed disabled:opacity-45',
            // Лист: крупные цели нажатия и разделители строк.
            'group-data-[layout=sheet]/sheet:min-h-12 group-data-[layout=sheet]/sheet:items-center group-data-[layout=sheet]/sheet:rounded-none group-data-[layout=sheet]/sheet:px-4 group-data-[layout=sheet]/sheet:py-0',
            'group-data-[layout=sheet]/sheet:[&+&]:[border-top:1px_solid_color-mix(in_oklab,var(--border)_55%,transparent)]',
          )}
          data-floating-menu-item=""
          disabled={item.disabled}
          data-active={!item.disabled && index === activeIndex ? '' : undefined}
          onmouseenter={() => { if (!item.disabled) activeIndex = index }}
          onclick={() => choose(item)}
        >
          <span>{item.label}</span>
          {#if item.hint}<span class="text-[0.75rem] text-muted-foreground" data-floating-menu-hint="">{item.hint}</span>{/if}
        </button>
      {/each}
    </div>
  </Portal>
{/if}

