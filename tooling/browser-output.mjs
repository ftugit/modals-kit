/** Диагностика неудачного браузерного сьюта: ошибки без маркера тоже видны. */
export function browserFailureLines(output, limit = 12) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const marked = lines.filter((line) => line.includes('FAIL') || line.includes('❌'))
  return (marked.length ? marked : lines).slice(-limit).map((line) => line.slice(0, 500))
}
