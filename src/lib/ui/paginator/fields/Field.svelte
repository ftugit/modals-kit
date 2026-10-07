<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    /**
     * ПОЧЕМУ поле недоступно (например, «источник не поддерживает поиск»).
     * Несёт причину отказа, а не общее пояснение режима: подсказка появляется
     * только когда поле выключено возможностями источника.
     */
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
