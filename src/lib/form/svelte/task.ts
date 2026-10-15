// Отправка → формат задачи `#lib/task` для кнопки и глобального лоадера.
// Тип повторён структурно: библиотека форм ни от чего не зависит.
import type { FormState } from '../state'

type Progress =
  | { kind: 'bytes'; loaded: number; total: number }
  | { kind: 'steps'; done: number; total: number; step?: string }

/** Ожидание в формате задачи (как `TaskState` в `pending`). */
export type FormPending = { status: 'pending'; scope: 'local' | 'global'; label?: string; progress?: Progress }

/**
 * `pending`, пока идёт отправка (с `intent` — только этим действием), иначе
 * `idle`. Ход от транспорта (`state.progress`) передаётся как есть, если он уже в
 * формате задачи (`readTaskStream` из `#lib/fetch` отдаёт такой); иначе — ожидание
 * без подробностей. Своих подписей нет. Ошибку показывают поля, не кнопка.
 *
 *     <Button type="submit" task={formTask(form.state)}>Добавить</Button>
 */
export function formTask(state: FormState, intent?: string): { status: 'idle' } | FormPending {
  if (!state.pending || (intent !== undefined && state.pendingIntent !== intent)) return { status: 'idle' }
  const task = state.progress as FormPending | null | undefined
  return task?.status === 'pending' && (task.scope === 'local' || task.scope === 'global')
    ? task
    : { status: 'pending', scope: 'local' }
}
