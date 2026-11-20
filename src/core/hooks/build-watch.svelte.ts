// Подписка на смену билда: одна на приложение, монтируется в корневом layout.
import { updated } from '$app/state'
import { reloadOnceForStale } from './stale-build.js'

/** Новая версия на сервере — принудительная перезагрузка один раз. */
export function useBuildWatch(): void {
  $effect(() => {
    if (!updated.current) return
    reloadOnceForStale()
  })
}
