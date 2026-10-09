<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const switchVariants = variants(
    'relative inline-block shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-input transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:top-1/2 before:-translate-y-1/2 before:rounded-full before:bg-background before:shadow-sm before:transition-transform before:content-[""]',
    {
      size: {
        sm: 'h-4 w-7 before:left-0.5 before:h-3 before:w-3 checked:before:translate-x-3',
        md: 'h-5 w-9 before:left-0.5 before:h-3.5 before:w-3.5 checked:before:translate-x-4',
      },
    },
    {
      size: 'md',
    },
  )

  export type SwitchVariants = VariantProps<typeof switchVariants>
</script>

<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'size'> {
    size?: SwitchVariants['size']
  }

  let { size = 'md', class: cls, checked = $bindable(), ...rest }: Props = $props()
</script>

<input
  type="checkbox"
  role="switch"
  bind:checked
  class={cn(switchVariants({ size }), cls)}
  {...rest}
/>
