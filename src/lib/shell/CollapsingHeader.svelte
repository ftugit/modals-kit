<script lang="ts">
  // CollapsingHeader: 3-рядная шапка в стиле Google Картинок (1:1 порт SolidHono).
  //
  // - Часть потока (shrink-0, без fixed/absolute) — main занимает остаток через flex.
  // - Высота рядов не фиксирована — меряем ResizeObserver'ом.
  // - middle — position: sticky (top:0 / bottom:0), работает на CSS.
  // - top + bottom — скрытие/показ через JS синхронно со скроллом: скролл «съедается»
  //   шапкой 1:1, контент стоит, пока шапка едет. dock=top прячет при скролле вниз,
  //   dock=bottom — наоборот.
  // - Пустые ряды не занимают места; пустая шапка целиком — `hidden`.
  import { onMount, type Snippet } from 'svelte'
  import {
    HEADER_ROWS,
    headerHasSlots,
    rowHasSlots,
    type HeaderRow,
    type HeaderRows,
    type RowSlots,
  } from './page.svelte'
  import HeaderRowView from './HeaderRowView.svelte'

  interface Props {
    /** Ряды шапки из PageProvider. */
    rows: HeaderRows
    /** Где стоит шапка относительно main. */
    dock?: 'top' | 'bottom'
    /** Контейнер скролла шаблона (main). `undefined` — ждём mount; `'window'` — документ. */
    scrollContainer?: HTMLElement | 'window'
    /** Отключить JS-скрытие (оставить только sticky middle). */
    disabled?: boolean
    /** Дотягивать до 0/1 после остановки скролла. */
    snap?: boolean
    /** Элемент перед `start` в ряду (кнопка ☰). */
    leading?: (row: HeaderRow) => Snippet | undefined
    /** Своя разметка ряда. По умолчанию — HeaderRowView. */
    renderRow?: (row: HeaderRow, slots: RowSlots) => Snippet | undefined
    onProgress?: (p: number) => void
    class?: string
  }

  let {
    rows,
    dock = 'top',
    scrollContainer,
    disabled = false,
    snap = true,
    leading,
    renderRow,
    onProgress,
    class: className = '',
  }: Props = $props()

  let rootRef = $state<HTMLElement>()
  let outer = $state<Partial<Record<'top' | 'bottom', HTMLDivElement>>>({})
  let inner = $state<Partial<Record<'top' | 'bottom', HTMLDivElement>>>({})

  let progress = 0
  const height = { top: 0, bottom: 0 }
  let lastScroll: number | null = null
  let idleTimer: number | null = null

  const rowSlots = (row: HeaderRow): RowSlots => rows?.[row] ?? { start: [], center: [], end: [] }
  const has = (row: HeaderRow) => rowHasSlots(rows?.[row]) || Boolean(leading?.(row))

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

  const applyProgress = (p: number, animate = false) => {
    progress = clamp01(p)
    const paint = (o: HTMLDivElement | undefined, full: number) => {
      if (!o) return
      const h = Math.max(0, full * (1 - progress))
      o.style.transition = animate
        ? 'height 0.28s cubic-bezier(0.32,0.72,0,1), opacity 0.22s ease'
        : 'none'
      o.style.height = `${h}px`
      o.style.opacity = full <= 0 ? '1' : `${1 - progress * 0.15}`
      o.style.visibility = h < 0.6 && full > 0 ? 'hidden' : 'visible'
      const i = o.firstElementChild as HTMLElement | null
      if (i) {
        i.style.transform =
          dock === 'top'
            ? `translateY(${-progress * 10}px)`
            : `translateY(${progress * 10}px)`
        i.style.willChange = 'transform'
      }
    }
    paint(outer.top, height.top)
    paint(outer.bottom, height.bottom)
    rootRef?.setAttribute('data-progress', progress.toFixed(3))
    onProgress?.(progress)
  }

  const measure = () => {
    height.top = inner.top?.offsetHeight ?? 0
    height.bottom = inner.bottom?.offsetHeight ?? 0
    applyProgress(progress, false)
  }

  onMount(() => {
    measure()
    window.addEventListener('resize', measure)
    const t1 = window.setTimeout(measure, 300)
    const t2 = window.setTimeout(measure, 1200)

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      if (inner.top) ro.observe(inner.top)
      if (inner.bottom) ro.observe(inner.bottom)
    }

    return () => {
      window.removeEventListener('resize', measure)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      ro?.disconnect()
    }
  })

  // Реактивная перепривязка и замер при смене dock / disabled / rows
  $effect(() => {
    const _dock = dock
    const _disabled = disabled
    const _rows = rows

    if (_disabled) {
      applyProgress(0, false)
      return
    }

    // В следующем кадре, когда DOM обновился, перемеряем
    const raf = requestAnimationFrame(() => {
      measure()
    })
    return () => cancelAnimationFrame(raf)
  })

  // Скролл-синхронизация
  $effect(() => {
    if (disabled) {
      applyProgress(0, false)
      return
    }

    const sc = scrollContainer
    if (!sc) return
    const el = sc === 'window' ? null : sc
    const currentDock = dock
    const shouldSnap = snap

    const getST = () => (el ? el.scrollTop : window.scrollY)
    const setST = (v: number) => {
      if (el) el.scrollTop = v
      else window.scrollTo(0, v)
    }
    lastScroll = getST()

    const clearIdle = () => {
      if (idleTimer) {
        window.clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const scheduleSnap = () => {
      clearIdle()
      if (!shouldSnap) return
      idleTimer = window.setTimeout(() => {
        if (progress > 0.02 && progress < 0.98) applyProgress(progress > 0.5 ? 1 : 0, true)
      }, 260)
    }

    /** Съесть `amount` пикселей скролла шапкой в направлении hide (+1) / show (-1). */
    const consume = (st: number, amount: number, dir: 1 | -1, sign: 1 | -1) => {
      const total = height.top + height.bottom
      const need = dir === 1 ? (1 - progress) * total : progress * total
      const c = Math.min(amount, need)
      applyProgress(progress + (dir * c) / total, false)
      const reverted = st - sign * c
      lastScroll = reverted
      if (c > 0.5) setST(reverted)
      else lastScroll = st
      scheduleSnap()
    }

    const onScroll = () => {
      const st = getST()
      if (lastScroll === null) {
        lastScroll = st
        return
      }
      const delta = st - lastScroll
      if (delta === 0) return

      const total = height.top + height.bottom
      if (total <= 2) {
        lastScroll = st
        return
      }

      if (currentDock === 'top') {
        if (delta > 0 && progress < 1) return consume(st, delta, 1, 1)
        if (delta < 0 && progress > 0) return consume(st, -delta, -1, -1)
      } else {
        if (delta < 0 && progress < 1) return consume(st, -delta, 1, -1)
        if (delta > 0 && progress > 0) return consume(st, delta, -1, 1)
      }
      lastScroll = st
      scheduleSnap()
    }

    const target: EventTarget = el ?? window
    target.addEventListener('scroll', onScroll, { passive: true })

    const revealIfIdle = () => {
      const st = getST()
      const canScroll = el
        ? el.scrollHeight - el.clientHeight > 2
        : document.documentElement.scrollHeight - window.innerHeight > 2
      if ((st <= 0 || !canScroll) && progress > 0) {
        lastScroll = st
        applyProgress(0, true)
      }
    }

    let raf = 0
    const scheduleReveal = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        revealIfIdle()
      })
    }

    const mo =
      typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleReveal) : null
    mo?.observe(el ?? document.body, { childList: true, subtree: true })

    return () => {
      target.removeEventListener('scroll', onScroll)
      mo?.disconnect()
      if (raf) cancelAnimationFrame(raf)
      clearIdle()
    }
  })

  const order = $derived(dock === 'top' ? HEADER_ROWS : ([...HEADER_ROWS].reverse() as HeaderRow[]))
</script>

<header
  bind:this={rootRef}
  data-fe-header
  data-dock={dock}
  data-progress="0.000"
  class={`relative z-30 w-full shrink-0 border-border/70 bg-background/85 backdrop-blur ${dock === 'top' ? 'border-b' : 'border-t'} ${className} ${headerHasSlots(rows) ? '' : 'hidden'}`}
  style="contain: layout"
>
  {#each order as row (row)}
    {#if row === 'middle'}
      <div
        data-slot="middle"
        class={`sticky z-10 ${dock === 'top' ? 'top-0' : 'bottom-0'} ${has('middle') ? '' : 'hidden'}`}
      >
        <div class="py-2">
          {#if renderRow}
            {@const custom = renderRow('middle', rowSlots('middle'))}
            {#if custom}
              {@render custom()}
            {/if}
          {:else}
            <HeaderRowView
              slots={rowSlots('middle')}
              leading={leading?.('middle')}
            />
          {/if}
        </div>
      </div>
    {:else if row === 'top'}
      <div
        bind:this={outer.top}
        data-slot="top"
        class={`shrink-0 overflow-hidden ${has('top') ? '' : 'hidden'}`}
      >
        <div bind:this={inner.top} class="py-2">
          {#if renderRow}
            {@const custom = renderRow('top', rowSlots('top'))}
            {#if custom}
              {@render custom()}
            {/if}
          {:else}
            <HeaderRowView
              slots={rowSlots('top')}
              leading={leading?.('top')}
            />
          {/if}
        </div>
      </div>
    {:else if row === 'bottom'}
      <div
        bind:this={outer.bottom}
        data-slot="bottom"
        class={`shrink-0 overflow-hidden ${has('bottom') ? '' : 'hidden'}`}
      >
        <div bind:this={inner.bottom} class="py-2">
          {#if renderRow}
            {@const custom = renderRow('bottom', rowSlots('bottom'))}
            {#if custom}
              {@render custom()}
            {/if}
          {:else}
            <HeaderRowView
              slots={rowSlots('bottom')}
              leading={leading?.('bottom')}
            />
          {/if}
        </div>
      </div>
    {/if}
  {/each}
</header>
