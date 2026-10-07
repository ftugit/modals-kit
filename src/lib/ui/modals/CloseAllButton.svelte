<script lang="ts">
  // Порт CloseAllButton из src/ui/modals/close-all.tsx оригинала.
  // «Закрыть всё» (внешний вид; логика — lib/modals): чистит всю стопку;
  // если внутри есть заблокированная — кнопка недоступна.
  import { useChain, useChainLocked, useModals } from '$lib/modals/svelte'
  import { cn } from '$lib/ui/cn'
  import { modalButtonVariants } from './variants'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    class: cls,
    style,
    children,
    ...rest
  }: HTMLButtonAttributes & { class?: string; children?: import('svelte').Snippet } = $props()

  const m = useModals()
  const chain = useChain()
  const blocked = useChainLocked()
</script>

<button
  type="button"
  {...rest}
  onclick={() => m.modals.closeAll()}
  disabled={chain.current.length === 0 || blocked.value}
  title={blocked.value ? 'В стопке есть заблокированная модалка' : undefined}
  class={cn(modalButtonVariants({ variant: 'quiet' }), cls)}
  data-modal-btn=""
  {style}
>
  {#if children}{@render children()}{:else}Закрыть все ({chain.current.length}){/if}
</button>
