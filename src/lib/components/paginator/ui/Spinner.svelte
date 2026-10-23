<script lang="ts">
  // Тонкая обёртка пагинатора над единым `ui/spinner/Spinner.svelte` (без дублирования SVG).
  import { Spinner as UiSpinner } from '#lib/components/ui/index.js'

  interface Props {
    size?: number | string
    class?: string
  }

  let { size = 16, class: className }: Props = $props()

  const px = $derived(typeof size === 'number' ? `${size}px` : size)
</script>

<UiSpinner
  class={`text-muted-foreground ${className ?? ''}`}
  style={`width: ${px}; height: ${px};`}
/>
