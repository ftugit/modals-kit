<script lang="ts">
  import { useCtx } from './context.svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    page: number
    class?: string
    name?: string
    marker?: boolean
    children?: Snippet
  }

  let { page, class: className = '', name, marker = true, children }: Props = $props()

  const { anchors } = useCtx('PageAnchor', name)
  let anchorEl: HTMLDivElement | undefined = $state()
  let markerEl: HTMLDivElement | undefined = $state()

  $effect(() => {
    const p = page
    const el = anchorEl
    const mEl = marker ? markerEl : null
    if (!el) return
    const key = `page:${p}`
    anchors.observe(key, el, { type: 'page', page: p })
    if (mEl) anchors.observe(key, mEl, { type: 'page', page: p })
    return () => {
      anchors.unobserve(key, el)
      if (mEl) anchors.unobserve(key, mEl)
    }
  })
</script>

<div
  bind:this={anchorEl}
  class={className}
  data-pag-anchor={page}
  aria-hidden={!children ? 'true' : undefined}
>
  {#if marker}
    <div
      bind:this={markerEl}
      data-pag-marker={page}
      style="height: 0; overflow: hidden;"
    ></div>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</div>
