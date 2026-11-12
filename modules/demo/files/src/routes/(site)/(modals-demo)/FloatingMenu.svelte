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
   * Меню пунктов демо. Цикл всплывашки — `Floating`: закрытие, прокрутка
   * и лист хоста живут там. Сюда передаётся только список.
   *
   * `aria-controls` на кнопке обязателен: по нему ловушка фокуса модалки
   * признаёт портированное меню своим (решение D31).
   */
  import { Button } from '#components/ui/index.js'
  import Floating from '#components/ui/floating/Floating.svelte'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { cn } from '#components/utils.js'
  import type { MobileAnchor } from '#lib/modals/index.js'

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
     * хоста. `false` — всегда выпадашка; `true` — всегда лист.
     */
    sheetOnNarrow?: boolean
    class?: string
  }
  let { label, items, mobile, sheetOnNarrow, class: cls }: Props = $props()

  const host = tryUseModals()
  const placement = { gap: 6, minSideSpace: 120, maxOverlayHeight: 320 }

  let open = $state(false)
  let activeIndex = $state(0)

  const enabled = $derived(items.filter((item) => !item.disabled))

  function onMenuChange(next: boolean) {
    if (next && !host) return
    if (next) activeIndex = 0
    open = next
  }

  function choose(item: FloatingMenuItem) {
    if (item.disabled) return
    item.onSelect?.()
    open = false
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    if (!host || open) return
    activeIndex = event.key === 'ArrowUp' ? Math.max(0, enabled.length - 1) : 0
    open = true
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
      event.preventDefault()
      activeIndex = 0
    } else if (event.key === 'End') {
      event.preventDefault()
      activeIndex = Math.max(0, enabled.length - 1)
    }
  }
</script>

<Floating
  {open}
  {label}
  {mobile}
  {sheetOnNarrow}
  minWidth={180}
  maxWidth={280}
  {placement}
  title={label}
  role="menu"
  autofocus
  onkeydown={onMenuKeydown}
  onOpenChange={onMenuChange}
>
  {#snippet trigger(api)}
    <Button
      variant="outline"
      ref={api.ref}
      class={cls}
      data-modal-btn=""
      aria-haspopup={api.popup}
      aria-expanded={api.expanded}
      aria-controls={api.controls}
      onclick={api.toggle}
      onkeydown={onTriggerKeydown}
    >
      {label}
    </Button>
  {/snippet}
  {#snippet render()}
    {#each items as item (item.label)}
      {@const index = enabled.indexOf(item)}
      <Button
        variant="plain"
        size="none"
        role="menuitem"
        class={cn(
          'flex w-full items-baseline justify-between gap-3 rounded-[7px] border-0 bg-transparent px-2.5 py-2 text-left text-inherit',
          'cursor-pointer data-[active]:bg-accent disabled:cursor-not-allowed disabled:opacity-45',
          'group-data-[layout=sheet]/sheet:min-h-12 group-data-[layout=sheet]/sheet:items-center group-data-[layout=sheet]/sheet:rounded-none group-data-[layout=sheet]/sheet:px-4',
          'group-data-[layout=sheet]/sheet:[&+&]:[border-top:1px_solid_color-mix(in_oklab,var(--border)_55%,transparent)]',
        )}
        data-floating-menu-item=""
        disabled={item.disabled}
        data-active={!item.disabled && index === activeIndex ? '' : undefined}
        onmouseenter={() => {
          if (!item.disabled) activeIndex = index
        }}
        onclick={() => choose(item)}
      >
        <span>{item.label}</span>
        {#if item.hint}<span class="text-xs text-muted-foreground" data-floating-menu-hint="">{item.hint}</span>{/if}
      </Button>
    {/each}
  {/snippet}
</Floating>
