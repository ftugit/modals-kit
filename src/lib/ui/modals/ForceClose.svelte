<script lang="ts">
  // Порт ForceClose из src/ui/modals/force-close.tsx оригинала.
  // Принудительное закрытие (внешний вид; логика — lib/modals):
  // единственный легальный выход из заблокированной модалки.
  import { useModals } from '$lib/modals/svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    /** Имя модалки; без него закрывается активная. */
    name,
    /** Закрыть всю стопку, включая заблокированные. */
    all = false,
    class: cls,
    style,
    children,
    onclick,
    ...rest
  }: HTMLButtonAttributes & {
    name?: string
    all?: boolean
    children?: import('svelte').Snippet
  } = $props()

  const m = useModals()
</script>

<button
  type="button"
  {...rest}
  onclick={(event) => {
    onclick?.(event)
    if (all) m.modals.forceCloseAll()
    else m.modals.forceClose(name)
  }}
  class={`modal-btn modal-btn-danger ${cls ?? ''}`}
  {style}
>
  {#if children}{@render children()}{:else}Закрыть принудительно{/if}
</button>
