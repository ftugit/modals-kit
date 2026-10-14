// Состояние каркаса приложения (dock, side, snap, progress, main).
import { getContext, onMount, setContext } from 'svelte'
import {
  hasShellCookie,
  LEGACY_SHELL_STORAGE_KEY,
  parseShellPrefs,
  shellCookieString,
  type HeaderDock,
  type ShellPrefs,
  type SidebarSide,
} from './prefs'

export type { HeaderDock, SidebarSide } from './prefs'

export class ShellState {
  dock = $state<HeaderDock>('top')
  side = $state<SidebarSide>('left')
  snap = $state(true)
  progress = $state(0)
  main = $state<HTMLElement | undefined>(undefined)

  /**
   * @param initial Сохранённые настройки — из cookie, прочитанной в load (B11).
   *   Конструктор не читает хранилищ браузера: сервер и клиент начинают с
   *   одного и того же состояния, иначе гидратация расходится с разметкой.
   */
  constructor(initial?: Partial<ShellPrefs> | null) {
    if (initial?.dock) this.dock = initial.dock
    if (initial?.side) this.side = initial.side
    if (typeof initial?.snap === 'boolean') this.snap = initial.snap
  }

  private persist() {
    if (typeof document === 'undefined') return
    document.cookie = shellCookieString({ dock: this.dock, side: this.side, snap: this.snap })
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

/**
 * Перенос настроек из localStorage (там они жили до B11) — один раз: ключ
 * удаляется сразу. Если cookie уже есть, главнее она: по ней сервер уже нарисовал
 * страницу. Только в браузере, после монтирования — до него состояние обязано
 * совпадать с серверным.
 */
function migrateLegacyPrefs(state: ShellState): void {
  let raw: string | null
  try {
    raw = localStorage.getItem(LEGACY_SHELL_STORAGE_KEY)
    if (raw === null) return
    localStorage.removeItem(LEGACY_SHELL_STORAGE_KEY)
  } catch {
    return                                   // хранилище запрещено — переносить нечего
  }
  if (hasShellCookie(document.cookie)) return
  const p = parseShellPrefs(raw)
  if (!p) return
  if (p.dock) state.dock = p.dock
  if (p.side) state.side = p.side
  if (typeof p.snap === 'boolean') state.snap = p.snap
  document.cookie = shellCookieString({ dock: state.dock, side: state.side, snap: state.snap })
}

/**
 * Создать состояние каркаса и положить в контекст. Вызывать при инициализации компонента.
 * @param initial Сохранённые настройки из cookie (см. `+layout.server.ts`).
 */
export function setShellContext(initial?: Partial<ShellPrefs> | null): ShellState {
  const state = new ShellState(initial)
  setContext(SHELL_CONTEXT_KEY, state)
  onMount(() => migrateLegacyPrefs(state))
  return state
}

export function useShell(): ShellState {
  const ctx = getContext<ShellState>(SHELL_CONTEXT_KEY)
  if (!ctx) {
    throw new Error('useShell() must be used inside AppShell')
  }
  return ctx
}
