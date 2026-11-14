/**
 * Набор целей формы блокировки: единственное место, где набор приводится к виду
 * перед отправкой.
 *
 * Правило цели (S1) плана сессий: клиент **не решает, кого в наборе нет**. Здесь
 * убираются только пустые части и повторы — своя цель остаётся, недопустимая цель
 * остаётся, и отказ приходит от сервера внятным кодом. Молчаливое вычитание себя
 * (`id === selfId`) запрещено: человек видел себя выбранным и должен получить ответ,
 * а не обнаружить, что набор тихо уменьшился.
 */

/** Разобрать список или CSV в цели: обрезка, без пустых, без повторов, порядок сохранён. */
export function normalizeSubjects(raw: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    for (const part of String(item ?? '').split(',')) {
      const id = part.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/**
 * Начальный набор формы: явный список важнее одиночной цели, одиночная цель важнее
 * среза из адреса. Ни один источник не правится по признаку «это я».
 */
export function resolveSeedSubjects(
  curSubjects: readonly string[] | undefined,
  curSubj: string | null | undefined,
  fromFilter: string | null | undefined,
): string[] {
  if (curSubjects && curSubjects.length > 0) return normalizeSubjects(curSubjects)
  if (curSubj && curSubj.trim()) return normalizeSubjects([curSubj])
  return fromFilter ? normalizeSubjects([fromFilter]) : []
}
