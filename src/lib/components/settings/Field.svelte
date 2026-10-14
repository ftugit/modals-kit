<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    /**
     * ПОЧЕМУ поле недоступно (возможности источника), см. `Toggle`. Рядом с
     * подписью и в `title`, а при переданном `hintId` — ещё и с идентификатором:
     * механизм указывает на него через `aria-describedby`.
     */
    hint?: string
    hintId?: string
    children?: Snippet
  }

  let { label, hint, hintId, children }: Props = $props()
</script>

<label class="block space-y-1" title={hint}>
  <span class="block text-xs font-medium text-muted-foreground">
    {label}{#if hint}<span class="ml-1 font-normal text-muted-foreground/80" data-field-hint id={hintId}>{hint}</span>{/if}
  </span>
  {#if children}
    {@render children()}
  {/if}
</label>
