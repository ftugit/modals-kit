// Чистая математика раскладок — без DOM и Solid. UI-компоненты (src/ui/paginator) её только
// применяют. Тестируется без браузера.
import type { PageGroup } from './types'

/** Окно номеров навигации: 1 … (c-2..c+2) … N — без стены из 60 кнопок при pageSize=5. */
export function pageWindow(
  total: number,
  current: number,
  around = 2,
  maxFlat = 9,
): (number | 'gap')[] {
  if (total <= maxFlat) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set<number>([1, total])
  for (let p = current - around; p <= current + around; p += 1) {
    if (p >= 1 && p <= total) set.add(p)
  }
  const nums = [...set].sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  let prev = 0
  for (const p of nums) {
    if (prev && p - prev > 1) out.push('gap')
    out.push(p)
    prev = p
  }
  return out
}

/** Предел разброса ширины колонки: одно число — симметрично (±), либо пара. Px или '%'. */
export type Stretch = number | string | { shrink: number | string; grow: number | string }

export type ColumnsAutoOptions = {
  /** Ширина контейнера, px. */
  width: number
  /** Целевая ширина колонки, px. */
  columnWidth: number
  /** Зазор между колонками, px. Default 0. */
  gap?: number
  /** Насколько колонка может стать уже/шире целевой (px или '%' от columnWidth). Default 0. */
  stretch?: Stretch
  /** Минимум колонок. Default 1. */
  min?: number
  /** Максимум колонок. Default ∞. */
  max?: number
}

export type ColumnsAutoResult = {
  /** Число колонок. */
  count: number
  /** Фактическая ширина колонки, px (при count=1 — вся ширина). */
  columnWidth: number
  /** Как вписали: 'exact' — целевая ширина, 'grow' — растянули, 'shrink' — сжали ради +1, 'single' — одна колонка без ограничений. */
  fit: 'exact' | 'grow' | 'shrink' | 'single'
}

function toPx(v: number | string, base: number): number {
  if (typeof v === 'number') return v
  const t = v.trim()
  if (t.endsWith('%')) return (parseFloat(t) / 100) * base
  return parseFloat(t) || 0
}

/**
 * Авто-число колонок по ширине контейнера.
 * n = floor((W + gap) / (colW + gap)); остаток либо вписывает n+1 колонку (если каждая ≥ colW − shrink),
 * либо растягивает n до (W − (n−1)·gap)/n (если ≤ colW + grow), иначе колонки остаются целевой ширины
 * (остаток — на совести CSS: justify). При n = 1 ограничений нет — колонка на всю ширину (мобильный).
 */
export function computeColumns(o: ColumnsAutoOptions): ColumnsAutoResult {
  const W = Math.max(0, o.width)
  const gap = o.gap ?? 0
  const colW = Math.max(1, o.columnWidth)
  const st = o.stretch ?? 0
  const shrink = toPx(typeof st === 'object' ? st.shrink : st, colW)
  const grow = toPx(typeof st === 'object' ? st.grow : st, colW)
  const min = Math.max(1, o.min ?? 1)
  const max = o.max ?? Number.POSITIVE_INFINITY
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const widthFor = (n: number) => (W - (n - 1) * gap) / n

  if (W <= 0) return { count: 1, columnWidth: W, fit: 'single' }
  const n = clamp(Math.floor((W + gap) / (colW + gap)))

  // Сначала попробовать ещё одну колонку за счёт сжатия (в т.ч. 1 → 2 на узком экране)
  if (n + 1 <= max) {
    const wPlus = widthFor(n + 1)
    if (wPlus >= colW - shrink && wPlus > 0)
      return { count: n + 1, columnWidth: wPlus, fit: 'shrink' }
  }
  // Одна колонка — без ограничения ширины (мобильный)
  if (n <= 1) return { count: 1, columnWidth: W, fit: 'single' }
  const w = widthFor(n)
  if (w > colW) {
    if (w <= colW + grow) return { count: n, columnWidth: w, fit: 'grow' }
    return { count: n, columnWidth: colW, fit: 'exact' }
  }
  return { count: n, columnWidth: w, fit: w === colW ? 'exact' : 'grow' }
}

/** Ячейка распределения по колонкам: элемент или слот-скелетон (item = null) с индексом. */
export type ColumnCell<T> = { page: number; item: T | null; index: number }

/**
 * Round-robin распределение групп страниц по колонкам (порядок чтения слева-направо, сверху-вниз).
 * pending-группы дают `slots` ячеек с item = null, если includeSlots (иначе 0 ячеек).
 */
export function distributeRoundRobin<T>(
  groups: readonly PageGroup<T>[],
  columns: number,
  includeSlots = true,
): ColumnCell<T>[][] {
  const n = Math.max(1, columns)
  const out: ColumnCell<T>[][] = Array.from({ length: n }, () => [])
  let i = 0
  for (const g of groups) {
    if (g.pending) {
      const count = includeSlots ? g.slots : 0
      for (let j = 0; j < count; j += 1, i += 1)
        out[i % n].push({ page: g.page, item: null, index: i })
    } else {
      for (const item of g.items) {
        out[i % n].push({ page: g.page, item, index: i })
        i += 1
      }
    }
  }
  return out
}

/** Раны одной колонки: подряд идущие ячейки одной страницы (блочный якорь на ран, D12). */
export function runsOfColumn<T>(
  col: readonly ColumnCell<T>[],
): { page: number; cells: ColumnCell<T>[] }[] {
  const runs: { page: number; cells: ColumnCell<T>[] }[] = []
  for (const cell of col) {
    const last = runs[runs.length - 1]
    if (last && last.page === cell.page) last.cells.push(cell)
    else runs.push({ page: cell.page, cells: [cell] })
  }
  return runs
}

/** Где рисовать строку «загрузка» без слотов: pending-группа выше загруженных → 'above', иначе 'below'. */
export function pendingSide<T>(
  groups: readonly PageGroup<T>[],
): { page: number; side: 'above' | 'below' } | null {
  const g = groups.find((x) => x.pending)
  if (!g) return null
  let minLoaded = Number.POSITIVE_INFINITY
  for (const x of groups) if (!x.pending && x.page < minLoaded) minLoaded = x.page
  return {
    page: g.page,
    side: minLoaded === Number.POSITIVE_INFINITY || g.page < minLoaded ? 'above' : 'below',
  }
}
