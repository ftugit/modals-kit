/**
 * Состояние задачи («лоадер») — ОДИН формат для всего, что показывает
 * ожидание: ссылки, кнопки, триггеры модалок, полоска сверху.
 *
 * Слои (решение владельца, ход 137):
 *  - ядро библиотеки говорит СВОИМИ словами (`status: 'loading'` пагинатора,
 *    `RuntimeStatus` модалок…) и этот модуль не импортирует никогда;
 *  - адаптер библиотеки к фреймворку переводит её слова в `TaskState`
 *    (`#lib/router/sveltekit.js` → `linkTask`, дальше — адаптеры остальных);
 *  - UI читает только `TaskState` (`asLink` в `#lib/components/links`).
 *
 * Модуль чистый: ни фреймворка, ни DOM — только тип и арифметика.
 */

/** Чем измеряется ход задачи. */
export type TaskProgress =
  /** Честный процент: байты известной длины (`Content-Length`). */
  | { kind: 'bytes'; loaded: number; total: number }
  /** Индикатор готовности: сколько этапов процесса завершено, а не сколько ждать. */
  | { kind: 'steps'; done: number; total: number; step?: string }

export type TaskState =
  | { status: 'idle' }
  | {
      status: 'pending'
      /** `global` — общая операция (запуск базы, сборка схемы), зажигает полоску у всех ждущих. */
      scope: 'local' | 'global'
      /** Что именно идёт — для подсказки и скринридера. */
      label?: string
      /** Нет — бегущий индикатор без числа. */
      progress?: TaskProgress
    }
  | { status: 'error'; message: string }

/** Задачи нет: один объект на всех, сравнение по ссылке дешёвое. */
export const IDLE_TASK: TaskState = Object.freeze({ status: 'idle' }) as TaskState

/**
 * Процент 0–100 (целый) или `null`, если числа нет: задача не идёт, хода не
 * сообщили или `total` неизвестен. Для `steps` это доля завершённых этапов.
 */
export function taskPercent(task: TaskState | null | undefined): number | null {
  if (!task || task.status !== 'pending' || !task.progress) return null
  const { total } = task.progress
  const done = task.progress.kind === 'bytes' ? task.progress.loaded : task.progress.done
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(done)) return null
  return Math.min(100, Math.max(0, Math.floor((done / total) * 100)))
}

/** Подпись для `title`/скринридера: «Запуск базы — шаг 2 из 4: проверка схемы», «43%». */
export function taskLabel(task: TaskState | null | undefined): string | undefined {
  if (!task || task.status !== 'pending') return task?.status === 'error' ? task.message : undefined
  const parts: string[] = []
  if (task.label) parts.push(task.label)
  const p = task.progress
  if (p?.kind === 'steps' && p.total > 0) parts.push(`шаг ${Math.min(p.done + 1, p.total)} из ${p.total}${p.step ? `: ${p.step}` : ''}`)
  const percent = taskPercent(task)
  if (p?.kind === 'bytes' && percent !== null) parts.push(`${percent}%`)
  return parts.length ? parts.join(' — ') : undefined
}
