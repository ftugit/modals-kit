<script lang="ts" module>
  /**
   * Задержка показа индикатора: переход, который уложился в неё, не мигает.
   * «Мелкие» записи адреса (модалки, пагинатор) держат `navigating` 1–2 мс
   * (замер хода 129) и сюда не доходят вовсе.
   */
  export const LINK_TASK_DELAY_MS = 150
</script>

<script lang="ts">
  /**
   * Ссылка приложения. Под капотом — ОБЫЧНАЯ `<a href>`: без JavaScript это
   * просто ссылка, браузер переходит сам (и сам показывает свою полоску).
   *
   * С JavaScript ссылка читает состояние задачи в одном формате (`#lib/task`):
   *  - по умолчанию — переход SvelteKit на её адрес (`linkTask` адаптера
   *    роутера): нажали — через 150 мс рядом с текстом спиннер, `aria-busy`;
   *  - `task` — состояние от другой библиотеки (пагинатор, форма…), когда
   *    ссылку перехватывает она, а не SvelteKit; тогда проценты, если есть,
   *    видны рядом со спиннером.
   *
   * Атрибуты потребителя расходятся ДО своих (правило примитивов): `href`,
   * `aria-busy` и `data-task-state` — за ссылкой. Свой `aria-busy`
   * потребителя (например, «Загрузить ещё») сохраняется, пока своей задачи нет.
   */
  import type { Snippet } from 'svelte'
  import type { HTMLAnchorAttributes } from 'svelte/elements'
  import { linkTask } from '#lib/router/sveltekit.js'
  import type { TaskState } from '#lib/task/index.js'
  import TaskIndicator from './TaskIndicator.svelte'

  interface Props extends HTMLAnchorAttributes {
    /** Состояние от библиотеки, которая ведёт эту ссылку сама; нет — переход SvelteKit. */
    task?: TaskState
    children?: Snippet
  }

  let { href, task, children, ...rest }: Props = $props()

  const current = $derived(task ?? linkTask(href))
  const pending = $derived(current.status === 'pending')

  // Таймер зависит только от «идёт / не идёт»: ход задачи (проценты) его не
  // перезапускает.
  let shown = $state(false)
  $effect(() => {
    if (!pending) {
      shown = false
      return
    }
    const timer = setTimeout(() => (shown = true), LINK_TASK_DELAY_MS)
    return () => clearTimeout(timer)
  })
</script>

<a
  {...rest}
  {href}
  aria-busy={shown ? true : rest['aria-busy']}
  data-task-state={shown ? 'pending' : undefined}
>
  {@render children?.()}{#if shown}<TaskIndicator task={current} class="ms-1.5" />{/if}
</a>
