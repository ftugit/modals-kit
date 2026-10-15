// Задача ДЕЙСТВИЯ над пагинатором — «Сброс», поиск: спиннер у того, кто
// запустил загрузку, а не у всех сразу. Пагинатор знает, ЧТО грузится
// (страницу), но не КТО это начал; это помнит UI.
import { untrack } from 'svelte'
import { paginatorTask, usePaginatorState } from '#lib/paginate/svelte/index.js'
import { IDLE_TASK, type TaskState } from '#lib/task/index.js'

export interface ActionTask {
  /** Действие запущено: следующая загрузка списка — его. */
  fire(): void
  /** Действие ничего не запустило (тот же запрос): забыть. */
  cancel(): void
  /** `pending`, пока идёт загрузка, запущенная этим действием. */
  task(): TaskState
}

/** Вызывать при инициализации компонента (эффект живёт вместе с ним). */
export function useActionTask(name?: string): ActionTask {
  const state = usePaginatorState(name)
  let armed = $state(false)
  let seen = false

  // Взведено → увидели загрузку → загрузка кончилась: действие отработало.
  $effect(() => {
    const loading = state().status === 'loading'
    untrack(() => {
      if (!armed) return
      if (loading) seen = true
      else if (seen) armed = seen = false
    })
  })

  return {
    fire() {
      armed = true
      seen = false
    },
    cancel() {
      armed = seen = false
    },
    task: () => (armed ? paginatorTask(state()) : IDLE_TASK),
  }
}
