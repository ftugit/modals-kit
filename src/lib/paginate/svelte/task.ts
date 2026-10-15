// Загрузка пагинатора → формат задачи `#lib/task` для ссылок и глобального лоадера.
// Тип повторён структурно: пакет пагинатора ни от чего не зависит.
import type { PaginatorState } from '../types'

type Progress =
  | { kind: 'bytes'; loaded: number; total: number }
  | { kind: 'steps'; done: number; total: number; step?: string }

/** Ожидание в формате задачи (как `TaskState` в `pending`). */
export type PaginatorPending = { status: 'pending'; scope: 'local' | 'global'; label?: string; progress?: Progress }

/**
 * `pending`, пока грузится страница (с `page` — только эта), иначе `idle`.
 * Ход, который сообщил источник (`state.progress`), передаётся как есть, если он
 * уже в формате задачи (`readTaskStream` из `#lib/fetch` отдаёт такой); иначе —
 * ожидание без подробностей. Своих подписей нет — слова в UI или от источника.
 * Ошибку показывает строка ошибки, не ссылка.
 *
 *     <a {...asLink(href, { task: () => paginatorTask(state(), page) })}>{page}</a>
 */
export function paginatorTask(
  state: Pick<PaginatorState<unknown>, 'status' | 'pending' | 'progress'>,
  page?: number,
): { status: 'idle' } | PaginatorPending {
  if (state.status !== 'loading' || (page !== undefined && state.pending?.page !== page)) return { status: 'idle' }
  return isPending(state.progress) ? state.progress : { status: 'pending', scope: 'local' }
}

function isPending(value: unknown): value is PaginatorPending {
  const task = value as PaginatorPending | null | undefined
  return task?.status === 'pending' && (task.scope === 'local' || task.scope === 'global')
}
