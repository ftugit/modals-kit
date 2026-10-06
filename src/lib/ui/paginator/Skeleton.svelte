<script lang="ts">
  interface Props {
    height?: number
    class?: string
  }

  let { height, class: className }: Props = $props()
</script>

<div
  data-testid="skeleton"
  style={height ? `height: ${height}px;` : undefined}
  class={`animate-pulse rounded-lg bg-muted/70 ${className ?? (height ? '' : 'h-12')}`}
></div>
