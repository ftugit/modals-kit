<script lang="ts">
  import { useCtx, usePaginatorOptions } from './context.svelte'

  interface Props {
    dir: 1 | -1
    name?: string
  }

  let { dir, name }: Props = $props()

  const { anchors } = useCtx('EdgeSentinel', name)
  const options = usePaginatorOptions(name)

  const active = $derived.by(() => {
    const o = options()
    const trig = dir === -1 ? o.topTrigger : o.bottomTrigger
    return o.mode === 'accumulate' && trig !== 'off' && trig !== 'manual'
  })

  let sentinelEl: HTMLDivElement | undefined = $state()

  $effect(() => {
    const el = sentinelEl
    const d = dir
    if (!el || !active) return
    const key = `sentinel:${d}`
    anchors.observe(key, el, { type: 'sentinel', dir: d })
    return () => {
      anchors.unobserve(key)
    }
  })
</script>

{#if active}
  <div
    bind:this={sentinelEl}
    data-pag-sentinel={dir}
    aria-hidden="true"
    style="height: 1px; width: 100%; flex-shrink: 0;"
  ></div>
{/if}
