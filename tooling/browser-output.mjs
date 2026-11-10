/** Диагностика неудачного сьюта: контекст и исключения без маркера тоже видны. */
export function browserFailureLines(output, limit = 12) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const tailStart = Math.max(0, lines.length - limit)
  return lines.filter((line, index) =>
    index >= tailStart || line.includes('FAIL') || line.includes('❌'),
  ).map((line) => line.slice(0, 500))
}
