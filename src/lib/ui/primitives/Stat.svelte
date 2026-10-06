<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const statVariants = variants(
    'flex flex-col gap-1 rounded-lg border border-border bg-card p-4',
    {
      size: {
        sm: 'p-3',
        md: 'p-4',
        lg: 'p-5',
      },
    },
    {
      size: 'md',
    },
  )

  export type StatVariants = VariantProps<typeof statVariants>
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    title: string | Snippet
    value: string | number | Snippet
    description?: string | Snippet
    size?: StatVariants['size']
  }

  let { title, value, description, size = 'md', class: cls, ...rest }: Props = $props()
</script>

<div
  class={cn(statVariants({ size }), cls)}
  {...rest}
>
  <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
    {#if typeof title === 'string'}
      {title}
    {:else}
      {@render title()}
    {/if}
  </div>
  <div class="text-2xl font-bold tracking-tight text-foreground">
    {#if typeof value === 'string' || typeof value === 'number'}
      {value}
    {:else}
      {@render value()}
    {/if}
  </div>
  {#if description}
    <div class="text-xs text-muted-foreground">
      {#if typeof description === 'string'}
        {description}
      {:else}
        {@render description()}
      {/if}
    </div>
  {/if}
</div>
