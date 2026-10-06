<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    children?: Snippet
  }

  let { label, children }: Props = $props()
</script>

<label class="block space-y-1">
  <span class="block text-xs font-medium text-muted-foreground">{label}</span>
  {#if children}
    {@render children()}
  {/if}
</label>
