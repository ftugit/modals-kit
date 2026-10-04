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
  class={cls ?? 'modal-btn modal-btn-quiet'}
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
    <div
      class="floating-menu"
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
      <div class="floating-menu-head">
        <span class="floating-menu-title">{label}</span>
        <button
          type="button"
          class="floating-menu-close"
          aria-label="Закрыть меню"
          onclick={() => closeMenu()}
        >✕</button>
      </div>
      {#each items as item, i (item.label)}
        {@const index = enabled.indexOf(item)}
        <button
          type="button"
          role="menuitem"
          class="floating-menu-item"
          disabled={item.disabled}
          data-active={!item.disabled && index === activeIndex ? '' : undefined}
          onmouseenter={() => { if (!item.disabled) activeIndex = index }}
          onclick={() => choose(item)}
        >
          <span>{item.label}</span>
          {#if item.hint}<span class="floating-menu-hint">{item.hint}</span>{/if}
        </button>
      {/each}
    </div>
  </Portal>
{/if}

<style>
  .floating-menu {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border-radius: calc(var(--radius) + 2px);
    border: 1px solid var(--border);
    background: var(--card, var(--popover));
    color: var(--card-foreground, var(--popover-foreground));
    box-shadow:
      0 20px 45px -12px color-mix(in oklab, var(--foreground) 30%, transparent),
      0 6px 16px -8px color-mix(in oklab, var(--foreground) 20%, transparent);
    outline: none;
    max-height: 100%;
    overflow: auto;
  }
  .floating-menu-item {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .floating-menu-item[data-active] {
    background: var(--accent);
    color: var(--accent-foreground, inherit);
  }
  .floating-menu-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .floating-menu-hint {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  /* Шапка нужна только листу. */
  .floating-menu-head { display: none; }
  .floating-menu-title {
    font-size: 0.95rem;
    font-weight: 600;
  }
  .floating-menu-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .floating-menu-close:hover { background: var(--accent); }

  /* ── Лист: то же меню, оформление модальной системы ──────────────────
     Повторяет язык листа у select: контейнер во всю высоту, шапка
     высотой 3.5rem с отбивкой 1rem, крупные цели нажатия, скругление
     только внешних углов (их даёт хост по data-mobile-anchor). */
  :global([data-layout='sheet']) .floating-menu {
    border: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -10px 40px -10px color-mix(in oklab, var(--foreground) 30%, transparent);
    height: 100%;
    gap: 0;
    padding: 0 0 max(8px, env(safe-area-inset-bottom)) 0;
    background: var(--card);
    color: var(--card-foreground);
  }
  :global([data-layout='sheet'][data-mobile-anchor='bottom']) .floating-menu {
    border-radius: 16px 16px 0 0;
    border-bottom: 0;
  }
  :global([data-layout='sheet'][data-mobile-anchor='top']) .floating-menu {
    border-radius: 0 0 16px 16px;
    border-top: 0;
  }
  :global([data-layout='sheet'][data-mobile-anchor='left']) .floating-menu {
    border-radius: 0 16px 16px 0;
    border-left: 0;
  }
  :global([data-layout='sheet'][data-mobile-anchor='right']) .floating-menu {
    border-radius: 16px 0 0 16px;
    border-right: 0;
  }
  :global([data-layout='sheet']) .floating-menu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 3.5rem;
    padding: 0 1rem;
    border-bottom: 1px solid var(--border);
  }
  :global([data-layout='sheet']) .floating-menu-item {
    min-height: 3rem;
    padding: 0 1rem;
    border-radius: 0;
    align-items: center;
  }
  :global([data-layout='sheet']) .floating-menu-item + .floating-menu-item {
    border-top: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
  }
</style>
