<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLFieldsetAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLFieldsetAttributes {
    legend?: string
    children?: Snippet
    legendSnippet?: Snippet
  }

  let { legend, legendSnippet, class: cls, children, ...rest }: Props = $props()
</script>

<fieldset
  class={cn('grid gap-1.5', cls)}
  {...rest}
>
  {#if legendSnippet}
    <legend class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {@render legendSnippet()}
    </legend>
  {:else if legend}
    <legend class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {legend}
    </legend>
  {/if}
  {#if children}{@render children()}{/if}
</fieldset>
