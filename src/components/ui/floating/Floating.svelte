<!--
  Всплывашка у якоря. Не модалка.

  Хост считает прямоугольник, ловит Escape и клик мимо, на узком экране
  сам включает лист. Здесь только запись хоста, удержание у якоря и рамка.
  Содержимое приходит снипетом `render` — как форма в `FiltersPanel`,
  не своим списком пунктов и не вторым циклом open/close.

  `popup` — обычное меню (`open`): лист можно выключить.
  `flow` — поверхность потока (`openFlow`): лист решает хост, своей
  опции «не быть листом» нет. Так открываются select и срезы шагов.

  Без хоста ничего не портирует и не рисует absolute-панель: `container`
  пуст, содержимое остаётся у вызывающего.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { Portal } from '@ark-ui/svelte/portal'
  import Button from '../button/Button.svelte'
  import CloseIcon from '../close-icon/CloseIcon.svelte'
  import { cn } from '#components/utils.js'
  import type { MobileAnchor } from '#lib/modals/index.js'
  import {
    tryUseModals,
    type HostFloatingCloseReason,
    type HostFloatingOptions,
    type HostFloatingPlacementOptions,
  } from '#lib/modals/svelte/index.js'

  /** То, что `render` получает от оболочки. `close` — просьба закрыть, не второй слушатель. */
  export interface FloatingRender {
    close: () => void
  }

  /** То, что сниппет `trigger` получает от оболочки: клик, якорь и aria живут здесь. */
  export interface FloatingTrigger {
    ref: (el: HTMLElement | null) => void
    expanded: boolean
    /** id контейнера хоста. Триггер ставит его в `aria-controls`. */
    controls: string | undefined
    popup: 'menu' | 'dialog' | 'listbox'
    /**
     * Левый клик без модификаторов. Без хоста не перехватывается — ссылка
     * уходит как есть. Догоняющий клик после закрытия гасится.
     */
    toggle: (event: MouseEvent) => void
  }

  interface Props {
    /** Открыта ли поверхность. Закрытие с хоста приходит в `onOpenChange(false)`. */
    open: boolean
    /** Якорь: по нему хост считает прямоугольник. Клик по нему — не «мимо». */
    anchor?: HTMLElement | null
    /** Ещё узлы, клик по которым не закрывает поверхность. */
    triggers?: Array<HTMLElement | null | undefined>
    /**
     * `popup` — меню, лист на узком экране можно выключить.
     * `flow` — всегда поток хоста (select, срезы).
     */
    mode?: 'popup' | 'flow'
    /** Имя слоя, когда хост делает из поверхности лист. */
    label?: string
    /** Только `popup`. Не задано — умолчание хоста. `false` — всегда выпадашка. */
    sheetOnNarrow?: boolean
    /** Только `popup`. Направление листа. Не задано — наследует хост. */
    mobile?: MobileAnchor
    listWidth?: 'trigger' | 'auto'
    /** Нижняя граница ширины. Уже якоря хост не сожмёт. */
    minWidth?: number
    maxWidth?: number
    /**
     * Размещение. Функция читается в момент open/update, поэтому может
     * смотреть на `window` — объект из шаблона так не умеет.
     */
    placement?: HostFloatingPlacementOptions | (() => HostFloatingPlacementOptions)
    dismiss?: HostFloatingOptions['dismiss']
    /**
     * Хост закрыл поверхность или содержимое попросило закрыть.
     * `programmatic` и `transfer` не приходят: их вызвал сам цикл.
     * Без причины — закрыла кнопка рамки или `render`.
     */
    onOpenChange?: (open: boolean, reason?: HostFloatingCloseReason) => void
    /** Вернуть фокус на якорь после Escape и «Назад». У select свой фокус — `false`. */
    returnFocus?: boolean
    /** Рамка и шапка листа. `false` — только портал, оболочку рисует `render` (select). */
    frame?: boolean
    /** Шапка листа. На выпадашке скрыта: признак режима кладёт хост. */
    title?: string
    class?: string
    role?: string
    onkeydown?: (event: KeyboardEvent) => void
    /** Фокус на рамку при открытии. Списку select не нужно: фокус ведёт он сам. */
    autofocus?: boolean
    /** Контейнер хоста. Его `id` триггер ставит в `aria-controls`. */
    container?: HTMLElement
    /** id записи хоста. Нужен трассировке select, не содержимому. */
    id?: string | null
    /** Момент закрытия хостом: догоняющий клик по якорю не открывает снова. */
    closedAt?: number
    /**
     * Кнопка или ссылка. Не задана — якорь передаёт вызывающий (`anchor`),
     * как у select и меток среза: у них свой жест открытия.
     */
    trigger?: Snippet<[FloatingTrigger]>
    /** `aria-haspopup` триггера. У списка select это `listbox`, не меню. */
    popup?: 'menu' | 'dialog' | 'listbox'
    render: Snippet<[FloatingRender]>
  }

  let {
    open,
    anchor = null,
    triggers,
    mode = 'popup',
    label,
    sheetOnNarrow,
    mobile,
    listWidth = 'auto',
    minWidth,
    maxWidth,
    placement,
    dismiss,
    onOpenChange,
    returnFocus = true,
    frame = true,
    title,
    class: cls = '',
    role,
    onkeydown,
    autofocus = false,
    container = $bindable<HTMLElement | undefined>(undefined),
    id = $bindable<string | null>(null),
    closedAt = $bindable(0),
    trigger,
    popup = 'menu',
    render,
  }: Props = $props()

  const host = tryUseModals()

  let floatingId = $state<string | null>(null)
  let ownedAnchor = $state<HTMLElement | null>(null)
  const anchorEl = $derived(anchor ?? ownedAnchor)

  const node = $derived.by(() => {
    if (!host || !floatingId) return undefined
    return host.floating.container(floatingId)
  })

  const shellClass = $derived(cn(
    'flex max-h-full flex-col overflow-auto rounded-[calc(var(--radius)+2px)] border border-border bg-card p-1.5 text-card-foreground outline-none',
    'shadow-[0_20px_45px_-12px_color-mix(in_oklab,var(--foreground)_30%,transparent),0_6px_16px_-8px_color-mix(in_oklab,var(--foreground)_20%,transparent)]',
    'group-data-[layout=sheet]/sheet:h-full group-data-[layout=sheet]/sheet:gap-0 group-data-[layout=sheet]/sheet:rounded-[16px] group-data-[layout=sheet]/sheet:p-0',
    'group-data-[layout=sheet]/sheet:pb-[max(8px,env(safe-area-inset-bottom))]',
    'group-data-[layout=sheet]/sheet:shadow-[0_-10px_40px_-10px_color-mix(in_oklab,var(--foreground)_30%,transparent)]',
    'group-data-[mobile-anchor=bottom]/sheet:rounded-b-none group-data-[mobile-anchor=bottom]/sheet:border-b-0',
    'group-data-[mobile-anchor=top]/sheet:rounded-t-none group-data-[mobile-anchor=top]/sheet:border-t-0',
    'group-data-[mobile-anchor=left]/sheet:rounded-l-none group-data-[mobile-anchor=left]/sheet:border-l-0',
    'group-data-[mobile-anchor=right]/sheet:rounded-r-none group-data-[mobile-anchor=right]/sheet:border-r-0',
    cls,
  ))

  function publish(options: HostFloatingOptions): HostFloatingOptions {
    if (mode !== 'flow') return options
    const { modalOnNarrow: _sheet, mobile: _mobile, ...flow } = options
    return flow
  }

  function buildOptions(): HostFloatingOptions | null {
    if (!anchorEl) return null
    const box = anchorEl.getBoundingClientRect()
    const rect = {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    }
    const place = typeof placement === 'function' ? placement() : placement
    const options: HostFloatingOptions = {
      rect,
      triggers: [anchorEl, ...(triggers ?? [])],
      listWidth,
      minWidth: Math.max(rect.width, minWidth ?? 0),
      maxWidth,
      placement: place,
      dismiss,
      label,
      onClose: onHostClose,
    }
    if (mode !== 'flow') {
      if (sheetOnNarrow !== undefined) options.modalOnNarrow = sheetOnNarrow
      if (mobile !== undefined) options.mobile = mobile
    }
    return publish(options)
  }

  function closeHost() {
    const current = floatingId
    if (!host || current === null) return
    floatingId = null
    host.floating.close(current)
  }

  function onHostClose(reason: HostFloatingCloseReason) {
    floatingId = null
    closedAt = Date.now()
    if (reason === 'programmatic' || reason === 'transfer') return
    if (returnFocus && (reason === 'escape' || reason === 'history')) {
      anchorEl?.focus({ preventScroll: true })
    }
    onOpenChange?.(false, reason)
  }

  /** Кнопка рамки и `render`: родитель обязан погасить `open`. */
  function requestClose() {
    onOpenChange?.(false)
    untrack(closeHost)
  }

  function rememberAnchor(el: HTMLElement | null) {
    ownedAnchor = el
  }

  function toggle(event: MouseEvent) {
    if (event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    if (!host) return
    event.preventDefault()
    if (Date.now() - closedAt < 250) return
    onOpenChange?.(!open)
  }

  $effect(() => {
    const want = open
    const el = anchorEl
    const flow = mode
    void label
    void minWidth
    void maxWidth
    void listWidth
    void sheetOnNarrow
    void mobile
    void placement
    void dismiss
    if (!want || !host || !el) {
      untrack(closeHost)
      return
    }
    untrack(() => {
      const options = buildOptions()
      if (!options) {
        closeHost()
        return
      }
      if (floatingId === null) {
        floatingId = flow === 'flow' ? host.floating.openFlow(options) : host.floating.open(options)
      } else {
        host.floating.update(floatingId, options)
      }
    })
  })

  $effect(() => {
    if (!open || !host || floatingId === null || typeof window === 'undefined') return
    const current = floatingId
    const update = () => {
      if (floatingId !== current) return
      const options = buildOptions()
      if (options) host.floating.update(current, options)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  })

  $effect(() => {
    const next = node
    const nextId = floatingId
    if (container !== next) container = next
    if (id !== nextId) id = nextId
  })

  $effect(() => () => {
    untrack(closeHost)
  })
</script>

{#if trigger}
  {@render trigger({
    ref: rememberAnchor,
    expanded: open,
    controls: open && node?.id ? node.id : undefined,
    popup,
    toggle,
  })}
{/if}

{#if node}
  <Portal container={node}>
    {#if frame}
      <!-- Фокус на рамке нужен меню: стрелки принимает она, не пункт. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class={shellClass}
        data-floating=""
        {role}
        tabindex={autofocus || role ? -1 : undefined}
        aria-label={label}
        {onkeydown}
        {@attach (el) => {
          if (autofocus) el.focus({ preventScroll: true })
        }}
      >
        {#if title}
          <div
            class="hidden min-h-14 items-center justify-between gap-2 border-b border-border px-4 group-data-[layout=sheet]/sheet:flex"
            data-floating-head=""
          >
            <span class="text-[0.95rem] font-semibold" data-floating-title="">{title}</span>
            <Button variant="ghost" size="icon" data-floating-close="" aria-label="Закрыть" onclick={requestClose}>
              <CloseIcon />
            </Button>
          </div>
        {/if}
        {@render render({ close: requestClose })}
      </div>
    {:else}
      {@render render({ close: requestClose })}
    {/if}
  </Portal>
{/if}
