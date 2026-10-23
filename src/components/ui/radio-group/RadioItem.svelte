<script lang="ts" module>
  import { variants, type VariantProps } from '#components/utils.js'
  import { controlBase } from '../field/field'

  // Эталон: shadcn/ui v4 `RadioGroupItem` (`apps/v4/registry/new-york-v4/ui/radio-group.tsx`)
  // поверх нативного `<input type="radio">` для 100% работы и с JS, и без JS.
  export const radioItemVariants = variants(
    `${controlBase} aspect-square rounded-full text-primary checked:border-primary after:absolute after:top-1/2 after:left-1/2 after:hidden after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-primary after:content-[""] checked:after:block`,
    {
      size: {
        sm: 'size-3.5 after:size-1.5',
        md: 'size-4 after:size-2',
      },
    },
    {
      size: 'md',
    },
  )

  export type RadioItemVariants = VariantProps<typeof radioItemVariants>
</script>

<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'size'> {
    size?: RadioItemVariants['size']
  }

  let { size = 'md', class: cls, checked, ...rest }: Props = $props()
</script>

<input
  type="radio"
  data-slot="radio-group-item"
  {checked}
  class={cn(radioItemVariants({ size }), cls)}
  {...rest}
/>
