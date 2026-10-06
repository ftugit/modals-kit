<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const labelVariants = variants(
    'text-sm font-medium leading-none text-foreground',
    {
      size: {
        sm: 'text-xs',
        md: 'text-sm',
        lg: 'text-base',
      },
    },
    {
      size: 'md',
    },
  )

  export type LabelVariants = VariantProps<typeof labelVariants>
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLLabelAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLLabelAttributes {
    size?: LabelVariants['size']
    children?: Snippet
  }

  let { size = 'md', class: cls, children, ...rest }: Props = $props()
</script>

<label
  class={cn(labelVariants({ size }), cls)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</label>
