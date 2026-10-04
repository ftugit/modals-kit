<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '../cn'

  interface Props {
    shown: 'first' | 'second'
    first: Snippet
    second: Snippet
    class?: string
  }

  let { shown, first, second, class: cls }: Props = $props()
</script>

<span class={cn('affix-swap', cls)}>
  <span data-swap={shown === 'first' ? 'shown' : 'hidden'} aria-hidden={shown !== 'first'}>
    {@render first()}
  </span>
  <span data-swap={shown === 'second' ? 'shown' : 'hidden'} aria-hidden={shown !== 'second'}>
    {@render second()}
  </span>
</span>
