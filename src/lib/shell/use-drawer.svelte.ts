// Логика мобильного drawer'а поверх checkbox + CSS:
// Esc закрывает, клик по фону закрывает, Back закрывает без навигации.
import { onMount } from 'svelte'

export interface DrawerOptions {
  input: () => HTMLInputElement | undefined
  panel: () => HTMLElement | undefined
  isNarrow: () => boolean
}

const HISTORY_FLAG = 'ddSidebar'

export function createDrawer(options: DrawerOptions) {
  let open = $state(false)

  const sync = () => {
    const el = options.input()
    open = Boolean(el?.checked)
  }

  const close = () => {
    const input = options.input()
    if (!input || !input.checked) return
    input.checked = false
    open = false
    if (typeof history !== 'undefined') {
      const st = history.state as Record<string, unknown> | null
      if (st && st[HISTORY_FLAG]) {
        history.back()
      }
    }
  }

  onMount(() => {
    const input = options.input()
    if (!input) return
    sync()

    const onChange = () => {
      sync()
      if (input.checked && typeof history !== 'undefined') {
        history.pushState({ ...(history.state ?? {}), [HISTORY_FLAG]: 1 }, '', location.href)
      }
    }

    const onPop = () => {
      const st = history.state as Record<string, unknown> | null
      if (!(st && st[HISTORY_FLAG]) && input.checked) {
        input.checked = false
        open = false
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && options.isNarrow()) {
        e.preventDefault()
        close()
      }
    }

    input.addEventListener('change', onChange)
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      input.removeEventListener('change', onChange)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  return {
    get isOpen() {
      return open
    },
    close,
  }
}

export function labelKeyHandler(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).click()
  }
}
