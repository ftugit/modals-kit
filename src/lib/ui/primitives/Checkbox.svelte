<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const checkboxVariants = variants(
    'relative shrink-0 cursor-pointer appearance-none rounded-[4px] border border-input bg-background shadow-xs transition-colors checked:border-primary checked:bg-primary after:absolute after:left-1/2 after:top-1/2 after:hidden after:h-2 after:w-1 after:-translate-x-1/2 after:-translate-y-[60%] after:rotate-45 after:border-b-2 after:border-r-2 after:border-primary-foreground after:content-[""] checked:after:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
    {
      size: {
        sm: 'h-3.5 w-3.5',
        md: 'h-4 w-4',
      },
    },
    {
      size: 'md',
    },
  )

  export type CheckboxVariants = VariantProps<typeof checkboxVariants>
</script>

<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'size'> {
    size?: CheckboxVariants['size']
  }

  let { size = 'md', class: cls, checked = $bindable(), ...rest }: Props = $props()
</script>

<input
  type="checkbox"
  bind:checked
  class={cn(checkboxVariants({ size }), cls)}
  {...rest}
/>
