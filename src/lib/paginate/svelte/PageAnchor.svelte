<script lang="ts">
  import type { Snippet } from 'svelte'
  import { useCtx } from './context.svelte'

  interface Props {
    page: number
    class?: string
    name?: string
    /** false — блок без маркера начала страницы (колонки: маркер только у рана с первой карточкой). */
    marker?: boolean
    children?: Snippet
  }

  let { page, class: className = '', name, marker = true, children }: Props = $props()

  const { anchors } = useCtx('PageAnchor', name)
  let anchorEl: HTMLDivElement | undefined = $state()
  let markerEl: HTMLDivElement | undefined = $state()

  $effect(() => {
    const p = page
    const el = marker !== false ? markerEl : null
    if (!el) return
    const key = `page:${p}`
    anchors.observe(key, el, { type: 'page', page: p })
    return () => {
      anchors.unobserve(key, el)
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
