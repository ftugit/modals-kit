<script lang="ts">
  import { untrack } from 'svelte'
  import { buttonVariants } from '#lib/components/ui/index.js'
  import { useLinkTo, usePaginatorActions } from '#lib/paginate/svelte/index.js'
  import { asLink, taskAttrs } from '#lib/components/links/index.js'
  import { useActionTask } from '../action-task.svelte.js'
  import type { Snippet } from 'svelte'

  interface Props {
    name?: string
    class?: string
    children?: Snippet
  }

  let { name: nameProp, class: className, children }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const { reset } = usePaginatorActions(name)
  // Ссылка — если транспорт её даёт (адрес): работает и без JS. Нет — кнопка.
  const hrefGetter = useLinkTo('reset', name)
  const href = $derived(hrefGetter())
  // Спиннер — пока грузится список, сброшенный ЭТОЙ кнопкой.
  const action = useActionTask(name)
  const cls = $derived(className ?? buttonVariants({ variant: 'ghost', size: 'xs' }))
  const run = () => {
    action.fire()
    reset()
  }
</script>

{#if href !== null}
  <a
    {...asLink(href, { task: action.task })}
    class={cls}
    onclick={(e) => {
      e.preventDefault()
      run()
    }}
  >
    {#if children}{@render children()}{:else}Сброс{/if}
  </a>
{:else}
  <button type="button" {...taskAttrs(action.task)} class={cls} onclick={run}>
    {#if children}{@render children()}{:else}Сброс{/if}
  </button>
{/if}
