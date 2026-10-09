<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    text: string
    testid?: string
    children?: Snippet
  }

  let { text, testid, children }: Props = $props()
</script>

<div
  data-testid={testid}
  class="flex items-center justify-center gap-2 py-2 text-center text-xs text-muted-foreground"
>
  {text}
  {#if children}
    {@render children()}
  {/if}
</div>
