/**
 * Общие часы только для смонтированных TimeAgo. На сервере подписок нет:
 * компонент начинает слушать в клиентском effect после гидрации.
 */
const subscribers = new Set<(now: number) => void>()
let interval: ReturnType<typeof setInterval> | undefined

export function subscribeLiveClock(subscriber: (now: number) => void): () => void {
  subscribers.add(subscriber)
  subscriber(Date.now())
  if (interval === undefined) {
    interval = setInterval(() => {
      const now = Date.now()
      for (const notify of subscribers) notify(now)
    }, 30_000)
  }

  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0 && interval !== undefined) {
      clearInterval(interval)
      interval = undefined
    }
  }
}
