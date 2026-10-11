// Svelte-обвязка lib search: подпись коррекции запроса. Слой повторяет
// устройство `#lib/paginate/svelte/index.js` — та же схема доступа к состоянию
// (аксессор + `.current`), то же правило: ядро (`#lib/search/index.js`) о Svelte не
// знает, обвязка живёт отдельным входом.
//
// Самой формы поиска здесь нет и быть не должно: поле запроса — обычное поле
// lib form, транспорт — GET-форма, а `commit` — это `setSearchQuery` из ядра
// (см. README). Хуков ровно столько, сколько нужно слою разметки: реактивная
// подпись «искали X → показываем Y».
import { createSubscriber } from 'svelte/reactivity'
import { getSearchCorrection, onSearchCorrection } from '../registry'
import type { SearchCorrectionInfo } from '../accumulator'

export type SearchCorrectionAccessor = (() => SearchCorrectionInfo | null) & {
  readonly current: SearchCorrectionInfo | null
}

/**
 * Подпись подмены запроса («искали X → показываем Y») — из основного контура
 * аккумулятора. Значение живёт в реестре search (не в компоненте), поэтому
 * несколько хуков на одно имя видят одно и то же.
 *
 * Реестр — внешний источник, и к рунам он подключён штатно: `createSubscriber`
 * (https://svelte.dev/docs/svelte/svelte-reactivity#createSubscriber). Чтение в
 * реактивном контексте подписывается на канал на время жизни эффекта, вне его —
 * просто отдаёт текущее значение реестра. Прежняя копия в `$state`, которую
 * `$effect` переписывал из подписки, отставала на такт и требовала вызова
 * строго при инициализации компонента (C8, docs/audit/crutches.md).
 */
export function useSearchCorrection(name: string): SearchCorrectionAccessor {
  const subscribe = createSubscriber((update) => onSearchCorrection(name, update))
  const read = (): SearchCorrectionInfo | null => {
    subscribe()
    return getSearchCorrection(name)
  }
  Object.defineProperty(read, 'current', { get: read, enumerable: true })
  return read as SearchCorrectionAccessor
}
