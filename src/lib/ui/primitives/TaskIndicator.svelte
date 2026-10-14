<script lang="ts">
  /**
   * Показ `TaskState` (`#lib/task`): спиннер, а если у задачи есть ход —
   * процент рядом; ошибка — знак «!» (тот же, что у триггера модалки).
   * В покое ничего не рисует.
   *
   * Для скринридера индикатор скрыт: о занятости сообщает владелец
   * (`aria-busy` у ссылки или кнопки), подпись задачи — в `title`. Иначе
   * доступное имя ссылки менялось бы посреди перехода («Пагинатор 43%»).
   */
  import type { HTMLAttributes } from 'svelte/elements'
  import { taskLabel, taskPercent, type TaskState } from '#lib/task/index.js'
  import { cn } from '../cn'
  import WarningIcon from './WarningIcon.svelte'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    task: TaskState
  }

  let { task, class: cls, ...rest }: Props = $props()

  const percent = $derived(taskPercent(task))
</script>

{#if task.status === 'error'}
  <span
    {...rest}
    class={cn('inline-flex items-center align-middle', cls)}
    title={taskLabel(task)}
    aria-hidden="true"
    data-task-indicator="error"
  >
    <WarningIcon size={16} />
  </span>
{:else if task.status === 'pending'}
  <span
    {...rest}
    class={cn('inline-flex items-center gap-1 align-middle', cls)}
    title={taskLabel(task)}
    aria-hidden="true"
    data-task-indicator="pending"
  >
    <span class="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"></span>
    {#if percent !== null}
      <span class="text-xs tabular-nums" data-task-percent="">{percent}%</span>
    {/if}
  </span>
{/if}
