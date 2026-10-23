<script lang="ts">
  import { Skeleton as UiSkeleton } from '#lib/components/ui/index.js'

  interface Props {
    height?: number
    class?: string
  }

  let { height, class: className }: Props = $props()
</script>

<UiSkeleton
  data-testid="skeleton"
  style={height ? `height: ${height}px;` : undefined}
  class={className ?? (height ? '' : 'h-12')}
/>
