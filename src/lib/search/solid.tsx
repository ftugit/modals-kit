// Solid-хуки lib search: подпись коррекции. Слои: lib НЕ импортирует
// @/fastedge|@/features|@/content|@/ui (§ 3.8, гейт project-structure.mjs).
// Реактивный запрос из адреса читается через app-store — хук
// `useSearchQuery` живёт у потребителя (src/features/search/useSearchQuery.ts),
// потому что store с адресом принадлежит фреймворку, а не библиотеке.
//
// САМОЙ формы поиска здесь нет — все поля приложения идут через lib form
// (решение 2026-09-29): поле запроса — обычное поле формы (`field.text` +
// валидатор длины), контрол рисует `FormField`, транспорт — `<Form
// method="get">`. Композицию собирает слой приложения (см.
// `src/features/search/SearchQueryForm.tsx`), потому что lib не зависит от
// ui-примитивов. Связь тонкая: `commit` — это `setSearchQuery`, ресинк
// deep-link'а — `resyncSearch` при монтировании хоста результатов.
import { createSignal, onCleanup } from 'solid-js'
import { getSearchCorrection, onSearchCorrection } from './registry'
import type { SearchCorrectionInfo } from './accumulator'

/** Подпись подмены запроса («искали X → показываем Y») из основного контура. */
export function useSearchCorrection(name: string): () => SearchCorrectionInfo | null {
  const [info, setInfo] = createSignal<SearchCorrectionInfo | null>(getSearchCorrection(name))
  onCleanup(onSearchCorrection(name, setInfo))
  return info
}
