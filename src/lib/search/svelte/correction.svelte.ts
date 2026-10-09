// Svelte-обвязка lib search: подпись коррекции запроса. Слой повторяет
// устройство `$lib/paginate/svelte` — та же схема доступа к состоянию
// (аксессор + `.current`), то же правило: ядро (`$lib/search`) о Svelte не
// знает, обвязка живёт отдельным входом.
//
// Самой формы поиска здесь нет и быть не должно: поле запроса — обычное поле
// lib form, транспорт — GET-форма, а `commit` — это `setSearchQuery` из ядра
// (см. README). Хуков ровно столько, сколько нужно слою разметки: реактивная
// подпись «искали X → показываем Y».
import { getSearchCorrection, onSearchCorrection } from '../registry'
import type { SearchCorrectionInfo } from '../accumulator'

export type SearchCorrectionAccessor = (() => SearchCorrectionInfo | null) & {
  readonly current: SearchCorrectionInfo | null
}

/**
 * Подпись подмены запроса («искали X → показываем Y») — из основного контура
 * аккумулятора. Значение живёт в реестре search (не в компоненте), поэтому
 * несколько хуков на одно имя видят одно и то же.
 */
export function useSearchCorrection(name: string): SearchCorrectionAccessor {
  let info = $state.raw<SearchCorrectionInfo | null>(getSearchCorrection(name))

  $effect(() => {
    info = getSearchCorrection(name)
    const off = onSearchCorrection(name, (next) => {
      info = next
    })
    return () => off()
  })

  const getter = () => info
  Object.defineProperty(getter, 'current', {
    get: () => info,
    enumerable: true,
  })

  return getter as SearchCorrectionAccessor
}
