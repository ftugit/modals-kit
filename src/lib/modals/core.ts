// Ядро: кодирование цепочки в адрес, разрешение записей, геометрия хвостов,
// блокировки. Framework-agnostic — не знает ни про фреймворк, ни про URL-объект,
// ни про DOM. Порт core.ts оригинала (SolidHono@shiki-final).
import { isRegistered } from './types'
import type {
  Chain,
  ChainEntry,
  RegisteredEntry,
  MobileAnchor,
  ModalDefinition,
  ModalSize,
  ResolvedEntry,
  StackMode,
  TailDirection,
} from './types'

/** Ключи, зарезервированные под переопределения регистратора. */
export const RESERVED_KEYS = [
  'size',
  'color',
  'tailColor',
  'mobile',
  'lock',
  'noForward',
  'pack',
] as const

export const CHAIN_KEY = 'modal'

type Lookup = (name: string) => ModalDefinition<any, any, any> | undefined

/* ── значения ──────────────────────────────────────────────────────── */

/** Разбор скаляра: true/false/null/число/строка. */
export function decodeScalar(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d*\.?\d+$/.test(raw)) {
    return Number(raw)
  }
  return raw
}

export function encodeScalar(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  )
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** Значение выразимо плоскими ключами? Иначе поедет в pack. */
export function isFlattenable(value: unknown): boolean {
  if (isScalar(value)) return true
  if (Array.isArray(value)) return value.every(isScalar)
  if (isPlainObject(value)) return Object.values(value).every(isFlattenable)
  return false
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let node = target
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    if (!isPlainObject(node[key])) node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[path[path.length - 1]] = value
}

function flatten(value: unknown, prefix: string, out: Array<[string, string[]]>) {
  if (isScalar(value)) {
    out.push([prefix, [encodeScalar(value)]])
    return
  }
  if (Array.isArray(value)) {
    out.push([prefix, value.map(encodeScalar)])
    return
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      flatten(v, `${prefix}.${k}`, out)
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/* ── размер ────────────────────────────────────────────────────────── */

/** Читает строковое представление fullpage или числового размера из адреса. */
export function decodeSize(raw: string): ModalSize | undefined {
  if (raw === 'fullpage') return 'fullpage'
  const m = raw.match(/^(\d+)x(\d+)$/)
  if (m) return { width: Number(m[1]), height: Number(m[2]) }
  return undefined
}

/** Превращает размер в пары query-ключа и значения. */
export function encodeSize(size: ModalSize): Array<[string, string]> {
  if (size === 'fullpage') return [['size', 'fullpage']]
  const out: Array<[string, string]> = []
  if (size.width !== undefined) out.push(['size.width', String(size.width)])
  if (size.height !== undefined) out.push(['size.height', String(size.height)])
  return out
}

/* ── адрес → цепочка ───────────────────────────────────────────────── */

/** Восстанавливает зарегистрированную цепочку из query-параметров. */
export function decodeChain(search: string | URLSearchParams, lookup: Lookup): RegisteredEntry[] {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const names = (params.get(CHAIN_KEY) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.length === 0) return []

  const chain: RegisteredEntry[] = names.map((name) => ({
    kind: 'registered' as const,
    name,
    params: {},
    overrides: {},
  }))

  for (const key of new Set(params.keys())) {
    if (!key.startsWith(`${CHAIN_KEY}.`)) continue
    const [indexRaw, ...path] = key.slice(CHAIN_KEY.length + 1).split('.')
    const index = Number(indexRaw)
    if (!Number.isInteger(index) || !chain[index] || path.length === 0) continue

    const entry = chain[index]
    const values = params.getAll(key)
    const head = path[0]

    if (head === 'pack') {
      try {
        const parsed = JSON.parse(decodeURIComponent(values[0]))
        if (isPlainObject(parsed)) Object.assign(entry.params, parsed)
      } catch {
        /* битый pack игнорируем */
      }
      continue
    }

    if (head === 'size') {
      if (path.length === 1) {
        const size = decodeSize(values[0])
        if (size) entry.overrides.size = size
      } else {
        const current =
          entry.overrides.size && entry.overrides.size !== 'fullpage' ? entry.overrides.size : {}
        entry.overrides.size = { ...current, [path[1]]: Number(values[0]) }
      }
      continue
    }
    if (head === 'color' || head === 'tailColor') {
      entry.overrides[head] = values[0]
      continue
    }
    if (head === 'mobile') {
      entry.overrides.mobile = values[0] as MobileAnchor | 'off'
      continue
    }
    if (head === 'lock') {
      entry.overrides.lock = values[0] !== 'false'
      continue
    }
    if (head === 'noForward') {
      entry.overrides.noForward = values[0] !== 'false'
      continue
    }

    // обычный параметр; тип берём из defaultParams регистратора, иначе по виду
    const definition = lookup(entry.name)
    const fallback = definition?.defaultParams?.[head]
    const decoded =
      values.length > 1
        ? values.map(decodeScalar)
        : typeof fallback === 'string'
          ? values[0]
          : decodeScalar(values[0])
    setPath(entry.params, path, decoded)
  }

  return chain
}

/* ── цепочка → ключи адреса ────────────────────────────────────────── */

/** Кодирует зарегистрированную цепочку в набор query-ключей, пропуская defaults. */
export function encodeChain(chain: RegisteredEntry[], lookup: Lookup): Record<string, string[]> {
  if (chain.length === 0) return {}
  const out: Record<string, string[]> = {
    [CHAIN_KEY]: [chain.map((e) => e.name).join(',')],
  }

  chain.forEach((entry, index) => {
    const definition = lookup(entry.name)
    const prefix = `${CHAIN_KEY}.${index}`
    const ov = entry.overrides

    // переопределения — только если отличаются от регистратора
    if (ov.size !== undefined && !sameValue(ov.size, definition?.size)) {
      for (const [k, v] of encodeSize(ov.size)) out[`${prefix}.${k}`] = [v]
    }
    if (ov.color !== undefined && ov.color !== definition?.color) {
      out[`${prefix}.color`] = [ov.color]
    }
    if (ov.tailColor !== undefined && ov.tailColor !== definition?.tailColor) {
      out[`${prefix}.tailColor`] = [ov.tailColor]
    }
    if (ov.mobile !== undefined && ov.mobile !== definition?.mobile) {
      out[`${prefix}.mobile`] = [ov.mobile]
    }
    if (ov.lock !== undefined && ov.lock !== (definition?.lock ?? false)) {
      out[`${prefix}.lock`] = [String(ov.lock)]
    }
    if (ov.noForward !== undefined && ov.noForward !== (definition?.noForward ?? false)) {
      out[`${prefix}.noForward`] = [String(ov.noForward)]
    }

    const pack: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry.params)) {
      if (value === undefined) continue
      if (sameValue(value, definition?.defaultParams?.[key])) continue
      if (!isFlattenable(value)) {
        pack[key] = value
        continue
      }
      const flat: Array<[string, string[]]> = []
      flatten(value, key, flat)
      for (const [k, v] of flat) out[`${prefix}.${k}`] = v
    }
    if (Object.keys(pack).length > 0) {
      out[`${prefix}.pack`] = [encodeURIComponent(JSON.stringify(pack))]
    }
  })

  return out
}

/** Готовая строка запроса (для href ссылок). */
export function chainToSearch(
  chain: RegisteredEntry[],
  lookup: Lookup,
  base?: URLSearchParams,
): string {
  const params = new URLSearchParams(base ? base.toString() : '')
  for (const key of [...params.keys()]) {
    if (key === CHAIN_KEY || key.startsWith(`${CHAIN_KEY}.`)) params.delete(key)
  }
  for (const [key, values] of Object.entries(encodeChain(chain, lookup))) {
    for (const v of values) params.append(key, v)
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/* ── слияние регистратора и переопределений ────────────────────────── */

/** Сливает определение, параметры и overrides записи в готовую конфигурацию вида. */
export function resolveEntry(entry: ChainEntry, index: number, lookup: Lookup): ResolvedEntry {
  // transient не живёт в реестре: содержимое пришло вместе с записью,
  // поэтому определения у неё нет, а «известной» она считается всегда.
  const definition = isRegistered(entry) ? lookup(entry.name) : undefined
  const ov = entry.overrides
  const mobileRaw = ov.mobile ?? definition?.mobile
  return {
    name: isRegistered(entry) ? entry.name : entry.id,
    index,
    params: isRegistered(entry) ? { ...(definition?.defaultParams ?? {}), ...entry.params } : {},
    size: ov.size ?? definition?.size ?? { width: 480 },
    color: ov.color ?? definition?.color ?? 'var(--card)',
    tailColor: ov.tailColor ?? definition?.tailColor ?? 'var(--border)',
    // Намерение сохраняем как есть: 'off' — это отказ записи, а не
    // «ничего не задано». Итоговый якорь считает `mobileAnchorOf`.
    mobile: mobileRaw,
    lock: ov.lock ?? definition?.lock ?? false,
    noForward: ov.noForward ?? definition?.noForward ?? false,
    known: isTransientEntry(entry) ? true : Boolean(definition),
    definition,
  }
}

const isTransientEntry = (e: ChainEntry) => e.kind === 'transient'

/* ── стопка ────────────────────────────────────────────────────────── */

/** Масштаб хвоста: каждый следующий меньше предыдущего. */
export function tailScaleAt(depthFromTop: number, tailScale: number): number {
  return tailScale ** depthFromTop
}

/** Индексы записей, рисуемых хвостами (ближний к активной — первый). */
export function visibleTails(chainLength: number, tailCount: number): number[] {
  if (chainLength < 2 || tailCount <= 0) return []
  const out: number[] = []
  for (let i = chainLength - 2; i >= 0 && out.length < tailCount; i -= 1) out.push(i)
  return out
}

/** На мобильном направление выводится из прижатия: слева → хвосты справа. */
export function resolveTailDirection(
  hostDirection: TailDirection,
  mobileAnchor: MobileAnchor | undefined,
  isMobile: boolean,
): TailDirection {
  if (isMobile && mobileAnchor) {
    const opposite: Record<MobileAnchor, TailDirection> = {
      left: 'right',
      right: 'left',
      top: 'bottom',
      bottom: 'top',
    }
    return opposite[mobileAnchor]
  }
  return hostDirection
}

/** Сдвиг хвоста в пикселях по направлению и глубине. */
export function tailOffset(
  direction: TailDirection,
  depthFromTop: number,
  step = 14,
): { x: number; y: number } {
  const d = depthFromTop * step
  switch (direction) {
    case 'top':
      return { x: 0, y: -d }
    case 'bottom':
      return { x: 0, y: d }
    case 'left':
      return { x: -d, y: 0 }
    case 'right':
      return { x: d, y: 0 }
    default:
      return { x: 0, y: 0 }
  }
}

/* ── видимая часть цепочки ─────────────────────────────────────────── */

/**
 * Цепочка без headless-записей — то, что вообще может быть нарисовано.
 *
 * 🔴 Единственный источник правды для слоя вида. Раньше фильтр жил только
 * в `ModalHost` и влиял лишь на `open`/`active`, а `Layers`, `Tails` и
 * `ModalContent` читали полную цепочку. Из-за этого headless-запись,
 * у которой содержимого нет по определению, становилась верхним визуальным
 * слоем: настоящая модалка уходила в `aria-hidden` + `inert`, а пользователь
 * видел пустую оболочку (ISSUES.md R-02).
 */
export function visibleChain(chain: Chain): Chain {
  return chain.filter((e) => e.overrides.headless !== true)
}

/* ── блокировка ────────────────────────────────────────────────────── */

/** Заблокирована ли активная модалка. */
export function isChainLocked(chain: Chain, lookup: Lookup): boolean {
  if (chain.length === 0) return false
  return resolveEntry(chain[chain.length - 1], chain.length - 1, lookup).lock
}

/** Есть ли в цепочке заблокированные записи (для «закрыть всё»). */
export function hasLockedEntry(chain: Chain, lookup: Lookup): boolean {
  return chain.some((entry, i) => resolveEntry(entry, i, lookup).lock)
}

/* ── ключи ─────────────────────────────────────────────────────────── */

/** Строит ключ runtime-состояния из позиции записи и её имени. */
export function runtimeKey(name: string, index: number): string {
  return `${index}:${name}`
}

/** Кеш загрузчика: имя + параметры. */
export function loaderKey(name: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return `${name}|${JSON.stringify(sorted)}`
}

/**
 * Каноническое сравнение записей по значению.
 *
 * Служебное поле `source` не является частью содержания записи: его
 * проставляет источник при чтении (`readPerSource`). Без проекции
 * собственная запись, вернувшаяся эхом из ядра, выглядела «изменившейся» —
 * и noForward-фильтр в `sync` срезал только что открытую noForward-модалку
 * (поймано приёмкой, тест 11).
 */
export function sameEntry(a: ChainEntry | undefined, b: ChainEntry): boolean {
  if (!a) return false // позиции нет в prev — запись «новая», не равна никакой
  // `source` объявлен только у RegisteredEntry, поэтому проекция — по записи
  // как по словарю: у transient этого поля просто нет.
  const strip = (e: ChainEntry) => {
    const rest = { ...(e as unknown as Record<string, unknown>) }
    delete rest.source
    return JSON.stringify(rest)
  }
  return strip(a) === strip(b)
}

/** Сравнивает цепочки по пользовательскому содержанию их записей. */
export function chainEquals(a: Chain, b: Chain): boolean {
  if (a.length !== b.length) return false
  return a.every((e, i) => sameEntry(e, b[i]))
}

/**
 * next — это prev, у которого закрыли несколько верхних модалок?
 * Возвращает число закрытых записей или null, если это не «закрытие хвоста».
 */
export function closedSuffix(prev: Chain, next: Chain): number | null {
  if (next.length >= prev.length) return null
  for (let i = 0; i < next.length; i += 1) {
    if (!sameEntry(prev[i], next[i])) return null
  }
  return prev.length - next.length
}

/**
 * Цепочка после открытия `entry` в заданном режиме стопки (`StackMode`).
 *
 * Единая точка правды для `open()` и href триггера: клик с JS и ссылка
 * без JS обязаны считать результат одинаково — расхождение прежнего
 * `fromRoot` (влиял только на href) устранено по решению владельца,
 * журнал §6 №9.
 */
export function nextChain(
  chain: ChainEntry[],
  entry: ChainEntry,
  stack?: StackMode,
): ChainEntry[] {
  if (stack === 'new') return [entry]
  if (stack === 'first') return [...chain.slice(0, 1), entry]
  return [...chain, entry]
}

/** href полноэкранной страницы по `definition.route`; null — маршрута нет. */
export function routeHref(
  route: string | ((params: any) => string) | undefined,
  params: Record<string, unknown>,
): string | null {
  if (!route) return null
  if (typeof route === 'function') return route(params)
  return route.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) =>
    encodeURIComponent(String(params[key] ?? '')),
  )
}

/* ── геометрия оболочки ────────────────────────────────────────────── */
/* Перенесено из shell.tsx оригинала. Там это уже было чистой математикой
   без DOM-эффектов; единственное, что осталось в слое фреймворка, —
   `useIsNarrow` (медиазапрос). */

/**
 * Итоговое прижатие записи: намерение записи сильнее умолчания хоста.
 *
 *   `mobile: 'bottom'` у записи → низ, что бы ни стояло у хоста;
 *   `mobile: 'off'`    у записи → без прижатия, даже если хост прижимает;
 *   ничего не задано              → умолчание хоста (`'off'` — не прижимать).
 */
export function mobileAnchorOf(
  entry: ResolvedEntry | null,
  isNarrow: boolean,
  hostDefault?: MobileAnchor | 'off',
): MobileAnchor | undefined {
  if (!entry || !isNarrow) return undefined
  if (entry.mobile === 'off') return undefined
  if (entry.mobile) return entry.mobile
  return hostDefault === 'off' || hostDefault === undefined ? undefined : hostDefault
}

/** Куда прижимать оболочку внутри viewport. */
export function viewportStyle(anchor: MobileAnchor | undefined): Record<string, string> {
  if (!anchor) {
    return { 'align-items': 'center', 'justify-content': 'center', padding: '16px' }
  }
  if (anchor === 'bottom') return { 'align-items': 'flex-end', 'justify-content': 'center' }
  if (anchor === 'top') return { 'align-items': 'flex-start', 'justify-content': 'center' }
  if (anchor === 'left') return { 'align-items': 'stretch', 'justify-content': 'flex-start' }
  return { 'align-items': 'stretch', 'justify-content': 'flex-end' }
}

const RADIUS = 16

/** Радиус: с прижатой стороны убирается; у fullpage его нет вовсе. */
export function radiusFor(entry: ResolvedEntry, anchor: MobileAnchor | undefined): string {
  if (entry.size === 'fullpage') return '0px'
  if (!anchor) return `${RADIUS}px`
  const r = `${RADIUS}px`
  const map: Record<MobileAnchor, string> = {
    top: `0 0 ${r} ${r}`,
    bottom: `${r} ${r} 0 0`,
    left: `0 ${r} ${r} 0`,
    right: `${r} 0 0 ${r}`,
  }
  return map[anchor]
}

/**
 * Габариты активной оболочки. В мобильном режиме размеры не действуют.
 * Высота: `size.height` — это минимум, а не жёсткий лимит; модалка растёт
 * под контент до `maxHeight`, поэтому маленькие модалки не загоняют
 * содержимое в скролл.
 */
export function shellBox(
  entry: ResolvedEntry,
  anchor: MobileAnchor | undefined,
  maxHeight = '80vh',
): Record<string, string | number | undefined> {
  if (entry.size === 'fullpage') {
    return { width: '100%', height: '100%', 'max-width': '100%', 'max-height': '100%' }
  }
  if (anchor === 'left' || anchor === 'right') {
    return { width: 'min(420px, 88vw)', height: '100%', 'max-height': '100%' }
  }
  if (anchor === 'top' || anchor === 'bottom') {
    return { width: '100%', 'max-width': '100%', 'max-height': maxHeight }
  }
  const size = entry.size
  const box: Record<string, string | number | undefined> = {
    width: size.width ? `min(${size.width}px, calc(100vw - 32px))` : 'auto',
    'max-width': 'calc(100vw - 32px)',
    'max-height': maxHeight,
  }
  // минимум из регистратора: контент больше — модалка растягивается
  if (size.height) box['min-height'] = `min(${size.height}px, calc(100vh - 32px))`
  return box
}

/** Возвращает полный inline-style оболочки записи: геометрию, фон и радиус. */
export function shellStyle(
  entry: ResolvedEntry,
  anchor: MobileAnchor | undefined,
  maxHeight?: string,
): Record<string, string | number | undefined> {
  return {
    ...shellBox(entry, anchor, maxHeight),
    background: entry.color,
    'border-radius': radiusFor(entry, anchor),
  }
}

/**
 * Хвост — пустая обманка. Габариты берём у активной оболочки,
 * поэтому при разных размерах модалок стопка остаётся ровной.
 */
export function tailStyle(options: {
  activeEntry: ResolvedEntry
  tailEntry: ResolvedEntry
  depthFromTop: number
  direction: TailDirection
  tailScale: number
  anchor: MobileAnchor | undefined
  stackAnimation: string
  entered: boolean
}): Record<string, string | number> {
  const {
    activeEntry, tailEntry, depthFromTop, direction,
    tailScale, anchor, stackAnimation, entered,
  } = options

  const scale = stackAnimation === 'none' ? 1 : tailScaleAt(depthFromTop, tailScale)
  const step = stackAnimation === 'deck' ? 22 : stackAnimation === 'fan' ? 10 : 14
  const { x, y } =
    stackAnimation === 'none' ? { x: 0, y: 0 } : tailOffset(direction, depthFromTop, step)
  const rotate =
    stackAnimation === 'fan' ? (direction === 'left' ? 1 : -1) * depthFromTop * 2 : 0

  // до появления хвост совпадает с активной оболочкой — отсюда «уход в стопку»
  const from = !entered

  return {
    // Хвост повторяет коробку активной оболочки один в один (inset: 0),
    // поэтому при разных размерах модалок стопка остаётся ровной.
    position: 'absolute',
    inset: 0,
    background: tailEntry.tailColor,
    'border-radius': radiusFor(activeEntry, anchor),
    transform: from
      ? 'translate3d(0,0,0) scale(1) rotate(0deg)'
      : `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${rotate}deg)`,
    opacity: from ? 0.9 : Math.max(0.25, 1 - depthFromTop * 0.18),
    'z-index': -depthFromTop,
    'pointer-events': 'none',
  }
}
