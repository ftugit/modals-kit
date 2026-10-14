type TraceWindow = Window & { __MODALS_SELECT_TRACE__?: boolean }

type SelectSnapshot = {
  id?: string
  name?: string
  multiple: boolean
  disabled: boolean
  open: boolean
  popupId?: string | null
  values: string[]
}

type SelectTraceOptions = {
  root: () => HTMLElement | null
  popup: () => HTMLElement | null
  snapshot: () => SelectSnapshot
}

const TRACE_EVENTS = [
  'pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'pointerover', 'pointerout',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'click',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'keydown', 'keyup', 'focusin', 'input', 'change',
] as const

const MOVE_EVENTS = new Set(['pointermove', 'mousemove', 'touchmove'])
const END_EVENTS = new Set(['click', 'pointercancel', 'touchcancel'])
const round = (value: number) => Math.round(value * 10) / 10

function elementOf(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target
  if (target instanceof Node) return target.parentElement
  return null
}

function describeElement(target: EventTarget | null): Record<string, unknown> | null {
  const element = elementOf(target)
  if (!element) {
    if (target === window) return { node: 'window' }
    if (target === document) return { node: 'document' }
    return target ? { node: target.constructor?.name ?? 'unknown' } : null
  }

  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const selectRoot = element.closest<HTMLElement>('[data-select-root]')
  const selectContent = element.closest<HTMLElement>('[data-select-content]')
  const floating = element.closest<HTMLElement>('[data-host-floating]')
  const modalLayer = element.closest<HTMLElement>('[data-modal-layer]')
  const modalStage = element.closest<HTMLElement>('[data-modal-stage]')
  const formControl = element as HTMLInputElement | HTMLSelectElement | HTMLButtonElement

  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    name: 'name' in formControl ? formControl.name || null : null,
    type: 'type' in formControl ? formControl.type || null : null,
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label'),
    text: element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 96) || null,
    data: {
      selectRoot: selectRoot?.querySelector('select')?.id || selectRoot?.getAttribute('data-select-root') || null,
      selectContent: selectContent?.id || null,
      floating: floating ? { id: floating.id || null, layout: floating.getAttribute('data-layout') } : null,
      modalLayer: modalLayer?.getAttribute('data-modal-layer') ?? null,
      modalStage: modalStage ? { id: modalStage.id || null, active: modalLayer?.hasAttribute('data-active') ?? false } : null,
      modalBackdrop: element.closest('[data-modal-backdrop]') !== null,
    },
    style: { pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex },
    rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
  }
}

function eventCoordinates(event: Event): { x?: number; y?: number } {
  if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY }
  }
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.changedTouches[0] ?? event.touches[0]
    if (touch) return { x: touch.clientX, y: touch.clientY }
  }
  return {}
}

function describeEvent(event: Event): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: event.type,
    isTrusted: event.isTrusted,
    defaultPreventedAtCapture: event.defaultPrevented,
    cancelable: event.cancelable,
    bubbles: event.bubbles,
    eventPhase: event.eventPhase,
  }

  if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
    Object.assign(base, {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      button: event.button,
      buttons: event.buttons,
      pressure: event.pressure,
      width: event.width,
      height: event.height,
    })
  } else if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
    Object.assign(base, { button: event.button, buttons: event.buttons, detail: event.detail })
  }

  if (typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent) {
    Object.assign(base, {
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
  }

  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const list = (touches: TouchList) => Array.from(touches).slice(0, 4).map((touch) => ({
      identifier: touch.identifier,
      x: round(touch.clientX),
      y: round(touch.clientY),
      force: touch.force,
    }))
    Object.assign(base, {
      touches: list(event.touches),
      changedTouches: list(event.changedTouches),
    })
  }

  return base
}

/** Install opt-in, dev-only window-capture tracing for one Select instance. */
export function installSelectTrace(options: SelectTraceOptions): () => void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return () => {}

  const traceWindow = window as TraceWindow
  const enabledByUrl = new URLSearchParams(window.location.search).get('selectTrace') === '1'
  let traceUntil = 0

  const onEvent = (event: Event) => {
    if (!(enabledByUrl || traceWindow.__MODALS_SELECT_TRACE__ === true)) return

    const target = event.target instanceof Node ? event.target : null
    const path = event.composedPath()
    const root = options.root()
    const popup = options.popup()
    const inRoot = Boolean(root && (path.includes(root) || root.contains(target)))
    const inPopup = Boolean(popup && (path.includes(popup) || popup.contains(target)))
    const state = options.snapshot()
    const isOpen = state.open || state.popupId != null

    if (event.type === 'pointerdown' && isOpen && !inRoot && !inPopup) {
      // Keep logging the pointerup/click that may be retargeted after close.
      traceUntil = Date.now() + 900
    }

    const outsideTail = Date.now() < traceUntil
    if (!inRoot && !inPopup && !isOpen && !outsideTail) return
    if (MOVE_EVENTS.has(event.type) && !inRoot && !inPopup) return

    const coords = eventCoordinates(event)
    const hit = coords.x === undefined || coords.y === undefined
      ? null
      : document.elementFromPoint(coords.x, coords.y)
    const pathInfo = path.slice(0, 10).map((entry) => describeElement(entry))
    const listbox = popup?.querySelector<HTMLElement>('[data-select-listbox]')
    const record = {
      at: new Date().toISOString(),
      elapsedMs: round(performance.now()),
      select: {
        ...state,
        inRoot,
        inPopup,
        popupLayout: popup?.getAttribute('data-layout') ?? null,
        listScrollTop: listbox?.scrollTop ?? null,
      },
      event: describeEvent(event),
      target: describeElement(event.target),
      hitTest: describeElement(hit),
      composedPath: pathInfo,
      activeElement: describeElement(document.activeElement),
      browser: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        maxTouchPoints: navigator.maxTouchPoints,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        input: {
          coarsePointer: matchMedia('(pointer: coarse)').matches,
          hoverNone: matchMedia('(hover: none)').matches,
        },
      },
      scroll: {
        windowX: window.scrollX,
        windowY: window.scrollY,
        documentTop: document.scrollingElement?.scrollTop ?? null,
        mainTop: document.querySelector<HTMLElement>('main')?.scrollTop ?? null,
        listTop: listbox?.scrollTop ?? null,
      },
    }

    // Delay only the print, not the snapshot: a timer runs after the complete
    // dispatch (including target/document handlers that can cancel the event).
    window.setTimeout(() => {
      console.info(`[modals/select-trace] ${JSON.stringify({
        ...record,
        event: {
          ...record.event,
          defaultPreventedAfterDispatch: event.defaultPrevented,
        },
      })}`)
    }, 0)

    if (END_EVENTS.has(event.type)) traceUntil = 0
  }

  for (const type of TRACE_EVENTS) window.addEventListener(type, onEvent, true)
  return () => {
    for (const type of TRACE_EVENTS) window.removeEventListener(type, onEvent, true)
  }
}
