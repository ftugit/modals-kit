// События пагинатора — transient (не реактивное состояние): toast/аналитика/расширения (R12/R14).
// Дословный порт events.ts React-версии.
import type { PaginatorEvent } from './types'

export type Emitter = {
  emit(event: PaginatorEvent): void
  on(handler: (event: PaginatorEvent) => void): () => void
}

export function createEmitter(): Emitter {
  const handlers = new Set<(event: PaginatorEvent) => void>()
  return {
    emit(event) {
      for (const handler of handlers) handler(event)
    },
    on(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}
