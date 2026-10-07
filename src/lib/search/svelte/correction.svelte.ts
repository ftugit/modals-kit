// Svelte 5-хук lib search: подпись коррекции запроса.
//
// Слои те же, что у Solid-версии (`../solid.tsx`): lib НЕ импортирует
// слой приложения (features/content/ui) — реактивный запрос из адреса
// читается у потребителя, потому что хранилище адреса принадлежит
// фреймворку, а не библиотеке. В порте на SvelteKit такой слой — роутер
// приложения (в репозитории: `$lib/router/sveltekit.ts`), а сама форма
// поиска — обычное поле обычной формы: композицию собирает приложение.
//
// Отличие от Solid-версии ровно одно — примитив реактивности: `$state`
// вместо `createSignal`. Контракт тот же: хук возвращает геттер значения
// (как `usePaginatorState` и прочие хуки слоя `$lib/paginate/svelte`),
// поэтому в разметке и в `$derived` он читается одинаково.
import { getSearchCorrection, onSearchCorrection } from '../registry'
import type { SearchCorrectionInfo } from '../accumulator'

/** Подпись подмены запроса («искали X → показываем Y») из основного контура. */
export function useSearchCorrection(name: string): () => SearchCorrectionInfo | null {
  let info = $state.raw<SearchCorrectionInfo | null>(getSearchCorrection(name))

  $effect(() => {
    // Переподписка при смене имени: значения предыдущего поиска не перетекают.
    info = getSearchCorrection(name)
    const off = onSearchCorrection(name, (next) => {
      info = next
    })
    return () => off()
  })

  return () => info
}
