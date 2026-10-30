<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { TimeAgo } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { asLink, taskAttrs } from '#hooks/links/index.js'
  import {
    getPaginatorContext,
    useLinkTo,
    usePaginatorActions,
    usePaginatorOptions,
    usePaginatorState,
  } from '#lib/paginate/svelte/index.js'
  import { useActionTask } from '../action-task.svelte.js'
  import {
    isChatStreamMode,
    nextSliceScrollProgress,
    resolveSliceTimestamp,
    shouldRenderPageSlice,
  } from '../slice.js'
  import type { PageSliceFloating, PageSliceProps } from '../types.js'
  import { pageSliceSurfaceVariants, pageSliceVariants } from '../variants.js'

  let {
    name: nameProp,
    enable,
    firstPageOnly = false,
    floating = false,
    hideOnScroll = false,
    jsOnly = false,
    page: pageProp,
    dividerLines = false,
    now,
    class: className,
  }: PageSliceProps = $props()

  // Имя пагинатора — идентичность привязки (необязательно внутри PaginatorHost).
  const explicitName = untrack(() => nameProp)
  const hostCtx = getPaginatorContext()

  // Плавающий режим допустим ТОЛЬКО внутри пагинатора, определённого контекстом без явного id.
  const canFloat = Boolean(hostCtx && explicitName === undefined)
  const effectiveFloating = $derived<PageSliceFloating>(
    canFloat && (floating === 'top' || floating === 'bottom') ? floating : false,
  )

  const pagState = usePaginatorState(explicitName)
  const hostOptions = usePaginatorOptions(explicitName)
  const { reset } = usePaginatorActions(explicitName)
  const hrefGetter = useLinkTo('reset', explicitName)
  const href = $derived(hrefGetter())
  const action = useActionTask(explicitName)

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  const sliceAt = $derived(resolveSliceTimestamp(pagState().extra))
  const currentPage = $derived(pageProp ?? pagState().page ?? 1)
  const visible = $derived(
    shouldRenderPageSlice({
      sliceAt,
      enable,
      firstPageOnly,
      currentPage,
      jsOnly,
      hydrated,
    }),
  )

  const chatMode = $derived(isChatStreamMode(hostOptions()))

  let rootEl = $state<HTMLDivElement>()
  let surfaceEl = $state<HTMLElement>()
  let naturalHeight = $state(32)
  let progress = $state(0)
  let snapping = $state(false)

  function resolveScrollContainer(el: HTMLElement | undefined): HTMLElement | Window {
    const hostEl = canFloat ? hostCtx?.container?.() : undefined
    let node: HTMLElement | null = hostEl ?? el?.parentElement ?? null
    while (node && node !== document.body && node !== document.documentElement) {
      const oy = getComputedStyle(node).overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
        return node
      }
      node = node.parentElement
    }
    return window
  }

  function readScrollOffset(target: HTMLElement | Window): {
    top: number
    atOrigin: boolean
  } {
    if (target === window) {
      const se = document.scrollingElement ?? document.documentElement
      const top = Math.max(0, window.scrollY)
      const atOrigin = chatMode
        ? top + window.innerHeight >= se.scrollHeight - 2
        : top <= 2
      return { top, atOrigin }
    }
    const box = target as HTMLElement
    const top = Math.max(0, box.scrollTop)
    const atOrigin = chatMode
      ? top + box.clientHeight >= box.scrollHeight - 2
      : top <= 2
    return { top, atOrigin }
  }

  $effect(() => {
    if (!visible || !hideOnScroll || !surfaceEl) {
      progress = 0
      snapping = false
      return
    }
    const targetSurface = surfaceEl
    const updateHeight = () => {
      const h = targetSurface.offsetHeight
      if (h > 0) naturalHeight = h
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(targetSurface)
    return () => ro.disconnect()
  })

  $effect(() => {
    if (!visible || !hideOnScroll || !rootEl) {
      progress = 0
      snapping = false
      return
    }
    // Читаем chatMode реактивно, чтобы при смене направления потока перепривязать отсчёт.
    const isChat = chatMode
    const scroller = resolveScrollContainer(rootEl)
    let lastTop = readScrollOffset(scroller).top
    let snapTimer: ReturnType<typeof setTimeout> | undefined
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      if (snapTimer !== undefined) clearTimeout(snapTimer)
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      snapTimer = undefined
      settleTimer = undefined
    }

    const onScroll = () => {
      const { top, atOrigin } = readScrollOffset(scroller)
      const delta = top - lastTop
      lastTop = top
      if (delta === 0) return

      clearTimers()
      snapping = false

      if (atOrigin) {
        progress = 0
        return
      }

      const distance = Math.max(36, naturalHeight * 1.5)
      const next = nextSliceScrollProgress(progress, delta, distance, isChat)
      progress = next

      if (next > 0 && next < 1) {
        snapTimer = setTimeout(() => {
          snapping = true
          progress = progress < 0.5 ? 0 : 1
          settleTimer = setTimeout(() => {
            snapping = false
          }, 280)
        }, 140)
      }
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimers()
      scroller.removeEventListener('scroll', onScroll)
    }
  })

  const runReset = () => {
    progress = 0
    action.fire()
    reset()
  }

  const resetControlClass =
    'cursor-pointer rounded-xs font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  const collapseStyle = $derived.by(() => {
    if (!hideOnScroll || (progress === 0 && !snapping)) return undefined
    const slideDir = effectiveFloating === 'bottom' ? 1 : -1
    const h = Math.max(0, (1 - progress) * naturalHeight)
    const op = Math.max(0, 1 - progress)
    const ty = slideDir * progress * 8
    const transition = snapping
      ? 'height 260ms cubic-bezier(0.32,0.72,0,1), opacity 220ms cubic-bezier(0.32,0.72,0,1), transform 260ms cubic-bezier(0.32,0.72,0,1), margin 260ms cubic-bezier(0.32,0.72,0,1)'
      : 'none'
    return `height:${h.toFixed(2)}px;opacity:${op.toFixed(3)};transform:translateY(${ty.toFixed(2)}px);overflow:clip;${progress >= 0.99 ? 'margin-top:0;margin-bottom:0;' : ''}transition:${transition};`
  })
</script>

{#snippet content(at: string)}
  <span>
    Отображается срез от <TimeAgo value={at} {now} class="font-medium text-foreground" />,{' '}
    {#if href !== null}
      <a
        {...asLink(href, { task: action.task })}
        data-testid="page-slice-reset"
        class={resetControlClass}
        onclick={(e) => {
          e.preventDefault()
          runReset()
        }}
      >сбросить?</a>
    {:else}
      <button
        type="button"
        {...taskAttrs(action.task)}
        data-testid="page-slice-reset"
        class={resetControlClass}
        onclick={runReset}
      >сбросить?</button>
    {/if}
  </span>
{/snippet}

{#if visible && sliceAt}
  <div
    bind:this={rootEl}
    data-testid="page-slice"
    data-floating={effectiveFloating || undefined}
    data-stream={chatMode ? 'chat' : 'normal'}
    data-progress={hideOnScroll ? progress.toFixed(3) : undefined}
    inert={hideOnScroll && progress >= 0.99 ? true : undefined}
    style={collapseStyle}
    onfocusin={() => {
      if (hideOnScroll && progress > 0) progress = 0
    }}
    class={cn(
      pageSliceVariants({
        floating: effectiveFloating ? effectiveFloating : 'none',
      }),
    )}
  >
    {#if dividerLines && !effectiveFloating}
      <span class="h-px flex-1 bg-border/60" aria-hidden="true"></span>
      <span
        bind:this={surfaceEl}
        class={cn(pageSliceSurfaceVariants({ cloud: false }), className)}
      >
        {@render content(sliceAt)}
      </span>
      <span class="h-px flex-1 bg-border/60" aria-hidden="true"></span>
    {:else}
      <div
        bind:this={surfaceEl}
        class={cn(pageSliceSurfaceVariants({ cloud: Boolean(effectiveFloating) }), className)}
      >
        {@render content(sliceAt)}
      </div>
    {/if}
  </div>
{/if}
