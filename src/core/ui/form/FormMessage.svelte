<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  export type FormMessageVariant = 'error' | 'muted'

  interface Props extends Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> {
    message?: string | null
    variant?: FormMessageVariant
    id?: string
    children?: Snippet
  }

  let { message, variant = 'error', id, class: cls, children, ...rest }: Props = $props()

  const text = $derived(typeof message === 'string' ? message.trim() : '')
</script>

{#if children || text}
  <p
    {...rest}
    {id}
    role={rest.role ?? (variant === 'error' ? 'alert' : 'status')}
    class={cn('text-sm', variant === 'error' ? 'text-destructive' : 'text-muted-foreground', cls)}
    data-slot="form-message"
    data-variant={variant}
  >
    {#if children}{@render children()}{:else}{text}{/if}
  </p>
{/if}
