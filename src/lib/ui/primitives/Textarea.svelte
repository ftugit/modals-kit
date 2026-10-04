<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLTextareaAttributes {}

  const fieldBase =
    'w-full rounded-md border border-input bg-background text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20'

  let { class: cls, value = $bindable(), ...rest }: Props = $props()
</script>

<textarea
  bind:value
  class={cn(fieldBase, 'min-h-20 px-3 py-2 text-sm', cls)}
  {...rest}
></textarea>
