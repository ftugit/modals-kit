// Отправка → формат задачи `#lib/task` для кнопки и глобального лоадера.
// Тип повторён структурно: библиотека форм ни от чего не зависит.
import type { FormState } from '../state'

/**
 * `pending`, пока идёт отправка (с `intent` — только этим действием), иначе
 * `idle`. Подписей нет — слова в UI. Ошибку показывают поля, не кнопка.
 *
 *     <Button type="submit" task={formTask(form.state)}>Добавить</Button>
 */
export function formTask(state: FormState, intent?: string): { status: 'idle' } | { status: 'pending'; scope: 'local' } {
  return state.pending && (intent === undefined || state.pendingIntent === intent)
    ? { status: 'pending', scope: 'local' }
    : { status: 'idle' }
}
