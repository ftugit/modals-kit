export type PageBack = 'history' | string

/** Выбрать «назад по истории» только для same-origin перехода с другой страницы. */
export function pageBackFrom(input: {
  referrer: string
  current: string
  href: string
}): PageBack {
  const ref = input.referrer.trim()
  if (!ref) return input.href
  try {
    const from = new URL(ref)
    const here = new URL(input.current)
    if (from.origin !== here.origin) return input.href
    if (from.pathname + from.search === here.pathname + here.search) return input.href
    return 'history'
  } catch {
    return input.href
  }
}
