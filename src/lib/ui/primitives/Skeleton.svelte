<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLDivElement> {}

  let { class: cls, ...rest }: Props = $props()
</script>

<div
  aria-hidden="true"
  class={cn('animate-pulse rounded-md bg-muted', cls)}
  {...rest}
></div>
