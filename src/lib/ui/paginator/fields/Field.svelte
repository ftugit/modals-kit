<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    /** Почему поле недоступно (например, источник не поддерживает возможность). */
    hint?: string
    children?: Snippet
  }

  let { label, hint, children }: Props = $props()
</script>

<label class="block space-y-1" title={hint}>
  <span class="block text-xs font-medium text-muted-foreground">
    {label}{#if hint}<span class="ml-1 font-normal text-muted-foreground/80" data-field-hint>{hint}</span>{/if}
  </span>
  {#if children}
    {@render children()}
  {/if}
</label>
