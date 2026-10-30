<script module lang="ts">
  import { untrack } from 'svelte'
  export { describeEvent } from '../event-log'
</script>

<script lang="ts">
  import { usePaginatorEvents } from '#lib/paginate/svelte/index.js'
  import { describeEvent as describe } from '../event-log'

  interface Props {
    name?: string
    limit?: number
    class?: string
  }

  let { name: nameProp, limit = 5, class: className }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)

  let events = $state<{ n: number; text: string }[]>([])
  let count = 0

  usePaginatorEvents((e) => {
    const seq = ++count
    events = [{ n: seq, text: describe(e) }, ...events].slice(0, limit)
  }, name)
</script>

<div
  class={className ?? 'mt-3 font-mono text-xs text-muted-foreground'}
  data-testid="event-log"
>
  <div class="font-semibold text-foreground/70">События пагинатора (последние {limit}):</div>
  {#if events.length === 0}
    <div class="italic text-muted-foreground">Пока нет событий</div>
  {:else}
    <ol class="mt-1 flex flex-col gap-0.5">
      {#each events as item (item.n)}
        <li class="flex items-center gap-2">
          <span class="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            #{item.n}
          </span>
          <span>{item.text}</span>
        </li>
      {/each}
    </ol>
  {/if}
</div>
