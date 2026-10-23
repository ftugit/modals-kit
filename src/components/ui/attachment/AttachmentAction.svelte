<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import Button from '../button/Button.svelte'
  import { cn } from '#components/utils.js'

  export type AttachmentActionProps = ComponentProps<typeof Button>

  let {
    variant = 'ghost',
    size = 'none',
    type = 'button',
    class: className,
    children,
    ...rest
  }: AttachmentActionProps = $props()
  const actionClass = $derived(cn(size === 'none' && 'size-8', 'shrink-0', className))
</script>

<Button
  data-slot="attachment-action"
  {variant}
  {size}
  {type}
  class={actionClass}
  {...rest}
>
  {@render children?.()}
</Button>
