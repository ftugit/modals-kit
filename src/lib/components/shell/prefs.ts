// Настройки каркаса (dock, side, snap): разбор и запись cookie.
//
// Cookie, а не localStorage (B11): сервер читает её в load и рисует ту же
// раскладку, что увидит клиент. Из localStorage читал только браузер — SSR
// рисовал раскладку по умолчанию, гидратация расходилась с разметкой, и
// шапка/боковая панель прыгали после загрузки.

export type HeaderDock = 'top' | 'bottom'
export type SidebarSide = 'left' | 'right'

/** Сохраняемые настройки каркаса. */
export interface ShellPrefs {
  dock: HeaderDock
  side: SidebarSide
  snap: boolean
}

/** Имя cookie с настройками каркаса. */
export const SHELL_COOKIE = 'dd-shell'
/** Прежний ключ localStorage: переносится в cookie один раз и удаляется. */
export const LEGACY_SHELL_STORAGE_KEY = 'dd-shell'
const MAX_AGE_S = 60 * 60 * 24 * 365

/**
 * Разобрать сохранённые настройки. Чужое значение (подделка, старый формат)
 * не ломает страницу: берутся только допустимые поля.
 * @param raw JSON из cookie или localStorage.
 * @returns Допустимые поля; `undefined` — нечего применить.
 */
export function parseShellPrefs(raw: string | null | undefined): Partial<ShellPrefs> | undefined {
  if (!raw) return undefined
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Partial<ShellPrefs> = {}
  if (o.dock === 'top' || o.dock === 'bottom') out.dock = o.dock
  if (o.side === 'left' || o.side === 'right') out.side = o.side
  if (typeof o.snap === 'boolean') out.snap = o.snap
  return Object.keys(out).length ? out : undefined
}

/**
 * Строка `document.cookie` для записи настроек. Значение кодируется
 * `encodeURIComponent` — `cookies.get` в SvelteKit раскодирует его тем же правилом.
 * @param p Настройки.
 */
export function shellCookieString(p: ShellPrefs): string {
  const value = encodeURIComponent(JSON.stringify({ dock: p.dock, side: p.side, snap: p.snap }))
  return `${SHELL_COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax`
}

/**
 * Есть ли cookie настроек в строке `document.cookie`.
 * @param cookieHeader Строка `document.cookie`.
 */
export function hasShellCookie(cookieHeader: string): boolean {
  return cookieHeader.split(';').some((c) => c.trim().startsWith(`${SHELL_COOKIE}=`))
}
