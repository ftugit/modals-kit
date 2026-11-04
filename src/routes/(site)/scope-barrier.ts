/** Синхронизирует область сессии с кешем SvelteKit, не открывая его при ошибке. */
export function createScopeBarrier<T>(options: {
  initial: T
  current: () => T
  waitAddress: () => Promise<void>
  refresh: () => Promise<void>
  matches: (scope: T) => boolean
  invalidate: () => void
}) {
  let applied = options.initial
  let epoch = 0
  let failed = false
  let barrier: Promise<void> = Promise.resolve()

  function start(scope: T, generation: number) {
    failed = false
    barrier = Promise.resolve().then(async () => {
      await options.waitAddress()
      if (generation !== epoch) return
      await options.refresh()
      if (generation !== epoch) return
      if (!options.matches(scope)) throw new Error('Session refresh did not settle')
    }).catch((error: unknown) => {
      if (generation === epoch) failed = true
      throw error
    })
    // Синхронный invalidate может вызвать загрузчик; барьер уже установлен.
    void barrier.catch(() => {})
  }

  function change(next: T) {
    if (next === applied) return
    applied = next
    start(next, ++epoch)
    options.invalidate()
  }

  async function run<R>(load: () => Promise<R>): Promise<R> {
    change(options.current())
    // Ошибка не разрешает старый кеш. Следующая попытка явно повторяет refresh.
    if (failed) start(applied, epoch)
    const generation = epoch
    await barrier
    if (generation !== epoch || options.current() !== applied) throw new Error('Session changed during modal preload')
    const result = await load()
    if (generation !== epoch || options.current() !== applied) throw new Error('Session changed during modal preload')
    return result
  }
  return { change, run }
}
