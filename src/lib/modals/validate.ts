// Проверка значений, пришедших ИЗВНЕ: из адреса (`?modal.N.color=…`) и из
// localStorage. Внутренний модуль — в `index.ts` не реэкспортируется.
//
// Зачем: цвет записи уходит в inline `style` оболочки и хвостов
// (`background: …`). Без проверки присланная ссылка дописывала любые
// объявления (`red;position:fixed;inset:0;z-index:…` — модалка поверх всего)
// и грузила чужие ресурсы через `url(…)` .
import type { ChainOverrides, MobileAnchor, ModalSize } from './types'

/**
 * Функции, допустимые в значении цвета. `url`, `image-set`, `element`,
 * `attr` и прочие сюда не входят — значит, внешний ресурс не подгрузить.
 */
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|(?:ok)?lab|(?:ok)?lch|color(?:-mix)?|light-dark|var)$/

/**
 * Значение — один CSS-цвет: ключевое слово, `#hex`, цветовая функция
 * (с вложенностью: `color-mix(in oklab, var(--a) 8%, var(--b))`) или
 * `var(--имя)`. Символов, которыми завершают объявление или открывают
 * строку/комментарий (`; : " ' * ! \ { }`), в нём быть не может.
 */
export function isSafeCssColor(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (v === '' || v.length > 200) return false
  if (!/^[\w#.,%\s/+()-]+$/.test(v)) return false

  let depth = 0
  for (let i = 0; i < v.length; i += 1) {
    const ch = v[i]
    if (ch === '(') {
      const fn = /([a-z][a-z-]*)$/i.exec(v.slice(0, i))?.[1]?.toLowerCase()
      if (!fn || !COLOR_FUNCTION.test(fn)) return false
      if (fn === 'var' && !/^\s*--[\w-]+\s*[,)]/.test(v.slice(i + 1))) return false
      depth += 1
    } else if (ch === ')') {
      depth -= 1
      if (depth < 0) return false
    } else if (/\s/.test(ch) && depth === 0) {
      return false // на верхнем уровне — ровно одно значение
    }
  }
  return depth === 0
}

/** Якорь мобильного режима из белого списка (F36). */
export const isMobileOverride = (value: unknown): value is MobileAnchor | 'off' =>
  value === 'top' || value === 'bottom' || value === 'left' || value === 'right' || value === 'off'

/** Размер в CSS-пикселях: конечное положительное число. */
export const isBoxDimension = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isBool = (value: unknown) => typeof value === 'boolean'

function sanitizeSize(raw: unknown): ModalSize | undefined {
  if (raw === 'fullpage') return raw
  if (typeof raw !== 'object' || raw === null) return undefined
  const box: { width?: number; height?: number } = {}
  for (const dim of ['width', 'height'] as const) {
    const v = (raw as Record<string, unknown>)[dim]
    if (isBoxDimension(v)) box[dim] = v
  }
  return Object.keys(box).length > 0 ? box : undefined
}

/** Проверка каждого поля переопределений из недоверенного носителя. */
const OVERRIDE_CHECKS: Record<string, (value: unknown) => boolean> = {
  color: isSafeCssColor,
  tailColor: isSafeCssColor,
  mobile: isMobileOverride,
  lock: isBool,
  noForward: isBool,
  headless: isBool,
}

/**
 * Переопределения записи из недоверенного носителя (localStorage): каждое
 * поле проверяется по типу, мусор отбрасывается по одному полю.
 */
export function sanitizeOverrides(raw: Record<string, unknown>): ChainOverrides {
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(OVERRIDE_CHECKS)) {
    if (check(raw[key])) out[key] = raw[key]
  }
  const size = sanitizeSize(raw.size)
  if (size) out.size = size
  return out as ChainOverrides
}
