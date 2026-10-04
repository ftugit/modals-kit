<script lang="ts">
  // Порт Control из src/features/modals/ModalsDemo.tsx оригинала.
  let {
    label,
    children,
  }: {
    label: string
    children?: import('svelte').Snippet
  } = $props()
</script>

<div>
  <div class="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
  {#if children}{@render children()}{/if}
</div>
