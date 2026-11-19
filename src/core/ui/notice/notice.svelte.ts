/** Очередь коротких уведомлений. Живёт только в браузере: SSR их не рисует. */
export type NoticeTone = 'success' | 'error'

export interface Notice {
  readonly id: number
  readonly text: string
  readonly tone: NoticeTone
}

let seq = 0
let items = $state<Notice[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const noticeQueue = {
  get items(): readonly Notice[] {
    return items
  },
}

export function dismissNotice(id: number): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  items = items.filter((item) => item.id !== id)
}

export function notify(
  text: string,
  options: { tone?: NoticeTone; timeout?: number } = {},
): number | null {
  const message = text.trim()
  if (!message || typeof window === 'undefined') return null
  const same = items.find((item) => item.text === message)
  if (same) return same.id
  const id = ++seq
  const tone = options.tone ?? 'success'
  items = [...items, { id, text: message, tone }]
  const timeout = options.timeout ?? 4000
  if (timeout > 0) {
    timers.set(
      id,
      setTimeout(() => dismissNotice(id), timeout),
    )
  }
  return id
}
