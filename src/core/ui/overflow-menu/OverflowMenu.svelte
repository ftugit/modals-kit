<script lang="ts" module>
  import type { Snippet } from 'svelte'

  /** Пункт меню действий. Ссылка остаётся рабочей без JS, `onClick` живёт только с JS. */
  export interface OverflowMenuItem {
    id: string
    label: string
    href?: string
    onClick?: (event: MouseEvent) => void
    icon?: Snippet
    description?: string
    shortcut?: string
    badge?: string
    group?: string
    disabled?: boolean
    destructive?: boolean
    separatorBefore?: boolean
    primary?: boolean
    /** Переключатель: `aria-pressed` на видимом пункте и в меню. */
    pressed?: boolean
    /**
     * Готовые атрибуты ссылки (включая attachments модальных ссылок): пункт
     * остаётся примитивом, а навигацию/открытие модалки задаёт носитель.
     */
    attrs?: object
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { cn } from '#core/ui/utils.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import Button from '../button/Button.svelte'
  import type { ButtonVariants } from '../button/Button.svelte'
  import Floating from '../floating/Floating.svelte'
  import MoreHorizontalIcon from './MoreHorizontalIcon.svelte'

  interface Props {
    items: readonly OverflowMenuItem[]
    /** Сколько пунктов видно; функция от ширины поддержана в `mode='fit'` (позже). */
    maxVisible?: number | ((width: number) => number)
    /** `count` — по числу; `fit` пока считается как `count` (стартовый режим плана). */
    mode?: 'count' | 'fit'
    moreBadge?: boolean
    moreLabel?: string
    orientation?: 'horizontal' | 'vertical'
    size?: 'sm' | 'md'
    variant?: ButtonVariants['variant']
    align?: 'start' | 'end'
    /** Без хоста модалок: `scroll` — строка со скроллом, `wrap` — перенос, `none` — скрыть. */
    fallback?: 'scroll' | 'wrap' | 'none'
    fallbackClass?: string
    sheetOnNarrow?: boolean
    onOpenChange?: (open: boolean) => void
    class?: string
    'data-testid'?: string
  }

  let {
    items,
    maxVisible = 3,
    mode = 'count',
    moreBadge = false,
    moreLabel = 'Ещё действия',
    orientation = 'horizontal',
    size = 'sm',
    variant = 'ghost',
    align = 'start',
    fallback = 'scroll',
    fallbackClass,
    sheetOnNarrow,
    onOpenChange,
    class: cls,
    'data-testid': testId,
  }: Props = $props()

  // Хост читается один раз: без него `Floating` не рисует меню, и работает fallback.
  const hasHost = untrack(() => tryUseModals() !== null)

  const limit = $derived(
    typeof maxVisible === 'number'
      ? Math.max(maxVisible, items.filter((item) => item.primary).length)
      : 3,
  )

  const split = $derived.by(() => {
    const primaries = items.filter((item) => item.primary)
    const rest = items.filter((item) => !item.primary)
    const room = Math.max(0, Math.max(limit, primaries.length) - primaries.length)
    return { visible: [...primaries, ...rest.slice(0, room)], hidden: rest.slice(room) }
  })

  let open = $state(false)
  let anchor = $state<HTMLElement | null>(null)

  // Фокус при открытии: контейнер меню, либо первый/последний пункт со стрелки на триггере.
  let menuEl = $state<HTMLElement | null>(null)
  let pendingFocus: 'container' | 'first' | 'last' = 'container'

  function setOpen(next: boolean) {
    open = next
    onOpenChange?.(next)
  }

  function focusItems(el: HTMLElement, mode: 'first' | 'last') {
    const nodes = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')]
    ;(mode === 'first' ? nodes[0] : nodes[nodes.length - 1])?.focus({ preventScroll: true })
  }

  $effect(() => {
    const el = menuEl
    if (!open || !el) return
    const mode = pendingFocus
    pendingFocus = 'container'
    if (mode === 'container') el.focus({ preventScroll: true })
    else focusItems(el, mode)
  })

  function onTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const mode = event.key === 'ArrowDown' ? 'first' : 'last'
    if (open && menuEl) focusItems(menuEl, mode)
    else {
      pendingFocus = mode
      setOpen(true)
    }
  }

  // Без JS `onClick`-пункты не работают: в fallback остаются только ссылки.
  const fallbackItems = $derived(items.filter((item) => item.href))

  const rowClass = $derived(
    cn(
      'flex min-w-0 items-center gap-1',
      orientation === 'vertical' ? 'flex-col items-stretch' : 'flex-wrap',
      align === 'end' && 'justify-end',
      cls,
    ),
  )

  const fallbackClassList = $derived(
    cn(
      'flex min-w-0 items-center gap-1',
      fallback === 'wrap' ? 'flex-wrap' : 'flex-nowrap overflow-x-auto',
      fallback === 'scroll' && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      align === 'end' && 'justify-end',
      fallbackClass,
    ),
  )

  function onMenuKeydown(event: KeyboardEvent, close: () => void) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      anchor?.focus()
      return
    }
    const nodes = [...((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'))]
    if (nodes.length === 0) return
    const index = nodes.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Home') {
      event.preventDefault()
      nodes[0]?.focus()
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      nodes[nodes.length - 1]?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      nodes[index === -1 ? 0 : (index + 1) % nodes.length]?.focus()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      nodes[index === -1 ? nodes.length - 1 : (index - 1 + nodes.length) % nodes.length]?.focus()
    }
  }

  /**
   * Пункт с asModalLink живёт вложением: пока идёт загрузка, снимать его
   * с DOM нельзя — cleanup вложения отменит открытие модалки. Закрываем меню,
   * когда вложение само сообщит исход через data-state (open/error).
   */
  function closeWhenModalLinkSettles(el: HTMLElement, close: () => void) {
    let settled = false
    let observer: MutationObserver | undefined

    const finish = () => {
      if (settled) return
      settled = true
      observer?.disconnect()
      close()
    }
    const check = () => {
      if (!el.isConnected) {
        observer?.disconnect()
        return
      }
      const state = el.getAttribute('data-state')
      if (state === 'open' || state === 'error') finish()
    }

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(check)
      observer.observe(el, { attributes: true, attributeFilter: ['data-state'] })
    }
    check()
  }
</script>

{#if !hasHost}
  {#if fallback !== 'none' && fallbackItems.length > 0}
    <div class={fallbackClassList} data-testid={testId ? `${testId}-fallback` : undefined} data-overflow-fallback="">
      {#each fallbackItems as item (item.id)}
        <Button
          {...item.attrs}
          href={item.href}
          {size}
          {variant}
          disabled={item.disabled}
          aria-pressed={item.href ? undefined : item.pressed}
          class={cn('min-w-0', item.destructive && 'text-destructive')}
          data-testid={testId ? `${testId}-${item.id}` : undefined}
        >
          {#if item.icon}{@render item.icon()}{/if}
          <span class="truncate">{item.label}</span>
          {#if item.badge}<span class="text-muted-foreground">{item.badge}</span>{/if}
        </Button>
      {/each}
    </div>
  {/if}
{:else}
  <div class={rowClass} data-testid={testId} data-overflow-menu="">
    {#each split.visible as item (item.id)}
      <Button
        {...item.attrs}
        href={item.href}
        onclick={item.onClick}
        {size}
        aria-pressed={item.href ? undefined : item.pressed}
        {variant}
        disabled={item.disabled}
        class={cn('min-w-0', item.destructive && 'text-destructive')}
        data-testid={testId ? `${testId}-${item.id}` : undefined}
      >
        {#if item.icon}{@render item.icon()}{/if}
        <span class="truncate">{item.label}</span>
        {#if item.badge}<span class="text-muted-foreground">{item.badge}</span>{/if}
      </Button>
    {/each}

    {#if split.hidden.length > 0}
      <Floating
        {open}
        {anchor}
        label={moreLabel}
        popup="menu"
        {sheetOnNarrow}
        onOpenChange={setOpen}
      >
        {#snippet trigger(t)}
          <Button
            ref={(el) => {
              t.ref(el)
              anchor = el
            }}
            onclick={(event) => {
              pendingFocus = 'container'
              t.toggle(event)
            }}
            onkeydown={onTriggerKeydown}
            aria-expanded={t.expanded ? 'true' : 'false'}
            aria-controls={t.controls}
            aria-haspopup={t.popup}
            variant="ghost"
            size="icon-sm"
            aria-label={moreBadge && split.hidden.length > 0 ? `${moreLabel}: скрыто ${split.hidden.length}` : moreLabel}
            data-testid={testId ? `${testId}-more` : 'overflow-more'}
          >
            <MoreHorizontalIcon />
            {#if moreBadge}<span class="text-xs tabular-nums text-muted-foreground">{split.hidden.length}</span>{/if}
          </Button>
        {/snippet}

        {#snippet render(f)}
          <div
            role="menu"
            tabindex="-1"
            aria-label={moreLabel}
            class="flex min-w-40 flex-col p-1"
            onkeydown={(event) => onMenuKeydown(event, f.close)}
            bind:this={menuEl}
            data-testid={testId ? `${testId}-menu` : 'overflow-menu'}
          >
            {#each split.hidden as item, i (item.id)}
              {#if item.group && (i === 0 || split.hidden[i - 1]?.group !== item.group)}
                <p class="px-2 pt-2 pb-1 text-xs text-muted-foreground">{item.group}</p>
              {/if}
              {#if item.separatorBefore && i > 0}
                <div role="separator" class="my-1 h-px bg-border"></div>
              {/if}
              {#if item.href}
                <a
                  {...item.attrs}
                  role={item.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  href={item.href}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  aria-checked={item.pressed}
                  class={cn(
                    'flex min-h-11 min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-9',
                    item.disabled && 'pointer-events-none opacity-50',
                    item.destructive && 'text-destructive',
                  )}
                  onclick={(event) => {
                    const el = event.currentTarget as HTMLElement
                    if (el.hasAttribute('data-modal-link')) {
                      // Вложение asModalLink отменяет загрузку, если снять ссылку
                      // с DOM до её завершения. Ждём исход от самого вложения и
                      // только потом снимаем меню. Фокус держит открывшаяся модалка.
                      closeWhenModalLinkSettles(el, f.close)
                      return
                    }
                    f.close()
                    anchor?.focus()
                  }}
                  data-testid={testId ? `${testId}-${item.id}` : undefined}
                >
                  {#if item.icon}{@render item.icon()}{/if}
                  <span class="min-w-0 flex-1 truncate">{item.label}</span>
                  {#if item.badge}<span class="text-xs text-muted-foreground">{item.badge}</span>{/if}
                  {#if item.shortcut}<span class="text-xs text-muted-foreground">{item.shortcut}</span>{/if}
                </a>
              {:else}
                <button
                  type="button"
                  role={item.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  aria-checked={item.pressed}
                  class={cn(
                    'flex min-h-11 min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-9',
                    item.disabled && 'pointer-events-none opacity-50',
                    item.destructive && 'text-destructive',
                  )}
                  onclick={(event) => {
                    if (item.disabled) return
                    item.onClick?.(event)
                    f.close()
                    anchor?.focus()
                  }}
                  data-testid={testId ? `${testId}-${item.id}` : undefined}
                >
                  {#if item.icon}{@render item.icon()}{/if}
                  <span class="min-w-0 flex-1 truncate">{item.label}</span>
                  {#if item.badge}<span class="text-xs text-muted-foreground">{item.badge}</span>{/if}
                </button>
              {/if}
            {/each}
          </div>
        {/snippet}
      </Floating>
    {/if}
  </div>
{/if}
