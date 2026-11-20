<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '#core/ui/utils.js'

  interface Props {
    label: string
    value?: string | number | null
    title?: string
    truncate?: boolean
    labelClass?: string
    valueClass?: string
    children?: Snippet
    'data-testid'?: string
  }

  let {
    label,
    value,
    title,
    truncate = false,
    labelClass,
    valueClass,
    children,
    'data-testid': testId,
  }: Props = $props()
</script>

<dt class={cn('text-muted-foreground', labelClass)}>{label}</dt>
<dd
  class={cn('min-w-0 break-words text-foreground', truncate && 'truncate', valueClass)}
  {title}
  data-testid={testId}
  data-slot="description-value"
>
  {#if children}{@render children()}{:else}{value ?? '—'}{/if}
</dd>
