// Якоря и сентинелы (R3, SPEC §3.7). DOM-слой, фреймворконезависимый.
// Текущая страница — модель «маркер + линия»: у каждой страницы маркер нулевой высоты в начале,
// линия детекта на `pageLine` от верха контейнера. Маркер пересёк линию вверх → страница началась;
// вернулся ниже линии + `pageHysteresis` → закончилась. Текущая = pickCurrentPage (max прошедших).
// Гистерезис нужен, потому что рука дрожит: без запаса одна и та же линия пересекается несколько раз.
// Сентинелы — свои IO на зоны краёв (topZone/bottomZone).
export type AnchorKind = { type: 'page'; page: number } | { type: 'sentinel'; dir: 1 | -1 }

export type AnchorTracker = {
  observe(el: Element, kind: AnchorKind): void
  unobserve(el: Element): void
  destroy(): void
}

export type AnchorTrackerHandlers = {
  /** Вызывается при ИЗМЕНЕНИИ множества страниц, чьи маркеры прошли линию (копия Set). */
  onPassedPages(pages: ReadonlySet<number>): void
  /**
   * Сентинел dir изменил видимость в СВОЕЙ зоне. edge — это всегда ПЕРЕХОД (IO не шлёт
   * событие без смены isIntersecting). motion — направление, откуда пришёл сентинел,
   * по boundingClientRect.top относительно прошлого события (IO-рецепт «prevY»):
   * -1 — контент едет вниз (пользователь листает ВВЕРХ), 1 — листает ВНИЗ, 0 — неизвестно
   * (первое событие/без смещения).
   */
  onSentinel(dir: 1 | -1, visible: boolean, motion: -1 | 0 | 1): void
}

/**
 * Зона триггера края: 'edge' — сам край контейнера (rootMargin 0); число — px;
 * строка — любая CSS-длина rootMargin ('40%', '200px'). Проценты считает браузер нативно.
 */
export type TriggerZone = 'edge' | number | string

/** rootMargin IO для зоны одного края: расширяем root только с нужной стороны. */
export function zoneRootMargin(zone: TriggerZone | undefined, side: 'top' | 'bottom'): string {
  const v =
    zone === undefined || zone === 'edge' ? '0px' : typeof zone === 'number' ? `${zone}px` : zone
  return side === 'top' ? `${v} 0px 0px 0px` : `0px 0px ${v} 0px`
}

export type AnchorTrackerOptions = {
  /** Зона ВЕРХНЕГО сентинела (см. TriggerZone). Default: 'edge'. */
  topZone?: TriggerZone
  /** Зона НИЖНЕГО сентинела. Default: 'edge'. */
  bottomZone?: TriggerZone
  /** Линия детекта текущей страницы от верха контейнера: доля (0..1) или px. Default 0.2. */
  pageLine?: number
  /** Запас обратного хода, px: страница «отменяется», когда маркер ниже линии на столько. Default 48. */
  pageHysteresis?: number
}

export function createAnchorTracker(
  root: Element | null,
  handlers: AnchorTrackerHandlers,
  opts?: AnchorTrackerOptions,
): AnchorTracker | null {
  if (typeof IntersectionObserver === 'undefined') return null // SSR/старое окружение — ядро работает без якорей
  const pageOf = new Map<Element, number>()
  const dirOf = new Map<Element, 1 | -1>()
  // Маркеры страниц (см. шапку файла): два IO — «передняя» линия и «задняя» (линия + запас).
  // Для маркера состояние бинарно относительно линии: rootMargin отрицательный сверху → полоса
  // [линия; низ контейнера]; «выше линии» ⇔ маркер вне полосы и top < верха полосы.
  const rootH = root ? root.clientHeight : typeof innerHeight === 'number' ? innerHeight : 0
  const lineOpt = opts?.pageLine ?? 0.2
  const lineFwd = Math.round(lineOpt <= 1 ? rootH * lineOpt : lineOpt)
  const hyst = Math.max(0, opts?.pageHysteresis ?? 48)
  const passed = new Set<number>()
  const fwdAbove = new Set<Element>() // маркер выше передней линии
  const backAbove = new Set<Element>() // маркер выше задней линии
  let destroyed = false
  const apply = () => {
    let changed = false
    for (const [el, page] of pageOf) {
      const was = passed.has(page)
      let now = was
      if (!was && fwdAbove.has(el)) now = true // пересёк переднюю линию вверх
      if (was && !backAbove.has(el)) now = false // опустился ниже задней линии
      if (now !== was) {
        if (now) passed.add(page)
        else passed.delete(page)
        changed = true
      }
    }
    if (changed) handlers.onPassedPages(new Set(passed))
  }
  const aboveOf = (set: Set<Element>) => (entries: IntersectionObserverEntry[]) => {
    if (destroyed) return // очередь IO переживает disconnect — не отчитываться пустым множеством
    for (const entry of entries) {
      // отвязанный элемент (страница перерисована) даёт нулевой rect → мусорное «выше»
      if (!entry.target.isConnected || !pageOf.has(entry.target)) continue
      const rootB = entry.rootBounds
      const isAbove = !entry.isIntersecting && !!rootB && entry.boundingClientRect.top < rootB.top
      if (isAbove) set.add(entry.target)
      else set.delete(entry.target)
    }
    apply()
  }
  const pagesIO = new IntersectionObserver(aboveOf(fwdAbove), {
    root,
    rootMargin: `-${lineFwd}px 0px 0px 0px`,
    threshold: 0,
  })
  const pagesBackIO = new IntersectionObserver(aboveOf(backAbove), {
    root,
    rootMargin: `-${lineFwd + hyst}px 0px 0px 0px`,
    threshold: 0,
  })
  // Направление по смещению сентинела между событиями (prevTop): при prepend с удержанием
  // позиции сентинел уезжает вверх БЕЗ скролла пользователя — это тоже «motion», но хост
  // отфильтрует его по своему детектору жеста; здесь только геометрия.
  const prevTop = new Map<Element, number>()
  const motionOf = (entry: IntersectionObserverEntry): -1 | 0 | 1 => {
    const top = entry.boundingClientRect.top
    const prev = prevTop.get(entry.target)
    prevTop.set(entry.target, top)
    if (prev == null || prev === top) return 0
    return top > prev ? -1 : 1
  }
  const topSentinelsIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) handlers.onSentinel(-1, entry.isIntersecting, motionOf(entry))
    },
    { root, rootMargin: zoneRootMargin(opts?.topZone, 'top'), threshold: 0 },
  )
  const bottomSentinelsIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) handlers.onSentinel(1, entry.isIntersecting, motionOf(entry))
    },
    { root, rootMargin: zoneRootMargin(opts?.bottomZone, 'bottom'), threshold: 0 },
  )
  return {
    observe(el, kind) {
      if (kind.type === 'page') {
        pageOf.set(el, kind.page)
        pagesIO.observe(el)
        pagesBackIO.observe(el)
      } else if (kind.dir === -1) {
        dirOf.set(el, -1)
        topSentinelsIO.observe(el)
      } else {
        dirOf.set(el, 1)
        bottomSentinelsIO.observe(el)
      }
    },
    unobserve(el) {
      const page = pageOf.get(el)
      if (page != null) {
        pageOf.delete(el)
        passed.delete(page)
        fwdAbove.delete(el)
        backAbove.delete(el)
        pagesIO.unobserve(el)
        pagesBackIO.unobserve(el)
      }
      const dir = dirOf.get(el)
      if (dir != null) {
        dirOf.delete(el)
        prevTop.delete(el)
        if (dir === -1) topSentinelsIO.unobserve(el)
        else bottomSentinelsIO.unobserve(el)
      }
    },
    destroy() {
      destroyed = true
      pagesIO.disconnect()
      pagesBackIO.disconnect()
      topSentinelsIO.disconnect()
      bottomSentinelsIO.disconnect()
      pageOf.clear()
      dirOf.clear()
      prevTop.clear()
      passed.clear()
    },
  }
}

/**
 * Реестр якорей пагинатора: элементы регистрируются эффектами компонентов (children
 * монтируются раньше эффекта хоста), трекер подключается позже — накопленные
 * регистрации переносятся в него при setTracker. Также хранит элементы для scrollToPage.
 */
export type AnchorRegistry = {
  observe(key: string, el: Element, kind: AnchorKind): void
  /** Без el — снять всё под ключом; с el — только этот элемент (раунд-4). */
  unobserve(key: string, el?: Element): void
  setTracker(tracker: AnchorTracker | null): void
  getElement(key: string): Element | null
}

export function createAnchorRegistry(): AnchorRegistry {
  // Раунд-4: на ключ может быть НЕСКОЛЬКО элементов (блочные якоря колонок: один на
  // колонку для страницы). getElement отдаёт ВЕРХНИЙ по rect.top — начало страницы.
  const entries = new Map<string, Map<Element, AnchorKind>>()
  let tracker: AnchorTracker | null = null
  return {
    observe(key, el, kind) {
      let set = entries.get(key)
      if (!set) {
        set = new Map()
        entries.set(key, set)
      }
      set.set(el, kind)
      tracker?.observe(el, kind)
    },
    unobserve(key, el) {
      const set = entries.get(key)
      if (!set) return
      if (el) {
        if (!set.has(el)) return
        set.delete(el)
        tracker?.unobserve(el)
        if (set.size === 0) entries.delete(key)
      } else {
        for (const element of set.keys()) tracker?.unobserve(element)
        entries.delete(key)
      }
    },
    setTracker(next) {
      if (tracker) {
        for (const set of entries.values()) for (const el of set.keys()) tracker.unobserve(el)
      }
      tracker = next
      if (next) {
        for (const set of entries.values()) {
          for (const [el, kind] of set) next.observe(el, kind)
        }
      }
    },
    getElement(key) {
      const set = entries.get(key)
      if (!set || set.size === 0) return null
      let best: Element | null = null
      let bestTop = Number.POSITIVE_INFINITY
      for (const el of set.keys()) {
        const top = el.getBoundingClientRect?.().top ?? 0
        if (top < bestTop) {
          bestTop = top
          best = el
        }
      }
      return best
    },
  }
}
