// Загрузка пагинатора → формат задачи `#lib/task` для ссылок и глобального лоадера.
// Тип повторён структурно: пакет пагинатора ни от чего не зависит.
import type { PaginatorState } from '../types'

/**
 * `pending`, пока грузится страница (с `page` — только эта), иначе `idle`.
 * Подписей нет — слова в UI. Ошибку показывает строка ошибки, не ссылка.
 *
 *     <a {...asLink(href, { task: () => paginatorTask(state(), page) })}>{page}</a>
 */
export function paginatorTask(
  state: Pick<PaginatorState<unknown>, 'status' | 'pending'>,
  page?: number,
): { status: 'idle' } | { status: 'pending'; scope: 'local' } {
  return state.status === 'loading' && (page === undefined || state.pending?.page === page)
    ? { status: 'pending', scope: 'local' }
    : { status: 'idle' }
}
