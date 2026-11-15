/**
 * Состояние выбора для списков (план сессий §S11).
 *
 * Пикер — отдельный носитель, не режим внутри списка. Список не хранит
 * выбранные id и не знает, один их выбирают или много. Этот хук даёт
 * носителю единый контракт: режим, набор, счётчик, сброс.
 *
 * Сброс при смене среза/актора — иначе выбранные id прошлого человека
 * останутся в памяти и уйдут в действие.
 */
export interface UseListSelectionOptions {
  /** Ключ среза (актор + фильтры) — при смене сбрасывается выбор. */
  sliceKey: () => string
}

/**
 * Стабильный ключ среза: порядок ключей не зависит от порядка объекта,
 * массивы сортируются, пустые значения не участвуют. Один helper на все
 * списки, чтобы `|` в значениях не склеивал разные срезы в один.
 */
export function selectionSliceKey(parts: Record<string, unknown>): string {
  const entries: string[] = []
  for (const [key, value] of Object.entries(parts)) {
    if (value === null || value === undefined || value === '') continue
    const text = Array.isArray(value)
      ? [...value].map((item) => String(item)).sort().join(',')
      : String(value)
    if (text === '') continue
    entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`)
  }
  return entries.sort().join('&')
}

export function useListSelection(options: UseListSelectionOptions) {
  let mode = $state(false)
  let ids = $state<Set<string>>(new Set())
  let allInSlice = $state(false)
  let lastSliceKey = $state<string | null>(null)

  // Сброс при смене среза/актора.
  $effect(() => {
    const key = options.sliceKey()
    if (lastSliceKey !== null && lastSliceKey !== key) {
      mode = false
      ids = new Set()
      allInSlice = false
    }
    lastSliceKey = key
  })

  const count = $derived(ids.size)

  function toggle(id: string) {
    const next = new Set(ids)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    ids = next
  }

  function selectAll(sliceIds: string[]) {
    ids = new Set(sliceIds)
    allInSlice = true
  }

  function clearAll() {
    ids = new Set()
    allInSlice = false
  }

  function enter() {
    mode = true
    ids = new Set()
    allInSlice = false
  }

  function exit() {
    mode = false
    ids = new Set()
    allInSlice = false
  }

  function isSelected(id: string): boolean {
    return ids.has(id)
  }

  return {
    get mode() { return mode },
    get ids() { return ids },
    get allInSlice() { return allInSlice },
    get count() { return count },
    toggle,
    selectAll,
    clearAll,
    enter,
    exit,
    isSelected,
  }
}