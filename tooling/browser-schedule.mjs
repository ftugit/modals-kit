/** Запускает независимые сегменты параллельно, а выбранные сьюты — без соседей. */
export async function runBrowserSchedule(names, concurrency, run, exclusive = () => false) {
  const limit = Math.max(1, Math.floor(concurrency) || 1)
  for (let start = 0; start < names.length;) {
    if (exclusive(names[start])) {
      await run(names[start], start)
      start += 1
      continue
    }
    let end = start + 1
    while (end < names.length && !exclusive(names[end])) end += 1
    let next = start
    const worker = async () => {
      for (;;) {
        const index = next++
        if (index >= end) return
        await run(names[index], index)
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, end - start) }, worker))
    start = end
  }
}
