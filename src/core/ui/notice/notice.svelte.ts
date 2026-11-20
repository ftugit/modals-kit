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

/** Одновременно показываем не больше трёх плашек. */
const MAX_NOTICES = 3

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

/** Снять все уведомления: уход со страницы или вкладка ушла в фон. */
export function dismissAllNotices(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  items = []
}

export function notify(
  text: string,
  options: { tone?: NoticeTone; timeout?: number } = {},
): number | null {
  const message = text.trim()
  if (!message || typeof window === 'undefined') return null
  const tone = options.tone ?? 'success'
  const timeout = options.timeout ?? 4000

  // Тот же текст в том же тоне не дублируется, но повтор продлевает жизнь плашки.
  const same = items.find((item) => item.text === message && item.tone === tone)
  if (same) {
    scheduleDismiss(same.id, timeout)
    return same.id
  }

  // Новая плашка вытесняет самую старую: очередь не растёт бесконечно.
  if (items.length >= MAX_NOTICES) dismissNotice(items[0]!.id)

  const id = ++seq
  items = [...items, { id, text: message, tone }]
  scheduleDismiss(id, timeout)
  return id
}

function scheduleDismiss(id: number, timeout: number): void {
  const existing = timers.get(id)
  if (existing) clearTimeout(existing)
  timers.delete(id)
  if (timeout > 0) {
    timers.set(
      id,
      setTimeout(() => dismissNotice(id), timeout),
    )
  }
}
