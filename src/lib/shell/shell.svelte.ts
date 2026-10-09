// Состояние каркаса приложения (dock, side, snap, progress, main).
import { getContext, onMount, setContext } from 'svelte'

export type HeaderDock = 'top' | 'bottom'
export type SidebarSide = 'left' | 'right'

export class ShellState {
  dock = $state<HeaderDock>('top')
  side = $state<SidebarSide>('left')
  snap = $state(true)
  progress = $state(0)
  main = $state<HTMLElement | undefined>(undefined)

  private storageKey = 'dd-shell'

  constructor() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.storageKey)
        if (raw) {
          const v = JSON.parse(raw)
          if (v.dock === 'top' || v.dock === 'bottom') this.dock = v.dock
          if (v.side === 'left' || v.side === 'right') this.side = v.side
          if (typeof v.snap === 'boolean') this.snap = v.snap
        }
      } catch {
        /* ignore */
      }
    }
  }

  private persist() {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({ dock: this.dock, side: this.side, snap: this.snap }),
      )
    } catch {
      /* ignore */
    }
  }

  setDock(d: HeaderDock) {
    this.dock = d
    this.persist()
  }

  setSide(s: SidebarSide) {
    this.side = s
    this.persist()
  }

  setSnap(v: boolean) {
    this.snap = v
    this.persist()
  }

  setProgress(p: number) {
    this.progress = Math.min(1, Math.max(0, p))
  }

  setMain(el: HTMLElement | undefined) {
    this.main = el
  }
}

const SHELL_CONTEXT_KEY = Symbol('SHELL_CONTEXT')

export function setShellContext(): ShellState {
  const state = new ShellState()
  setContext(SHELL_CONTEXT_KEY, state)
  return state
}

export function useShell(): ShellState {
  const ctx = getContext<ShellState>(SHELL_CONTEXT_KEY)
  if (!ctx) {
    throw new Error('useShell() must be used inside AppShell')
  }
  return ctx
}
