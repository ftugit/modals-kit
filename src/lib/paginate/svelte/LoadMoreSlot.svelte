<script lang="ts">
  import { canGo, canLoadMore } from '../pure'
  import { usePageHref, usePaginatorActions, usePaginatorOptions, usePaginatorState } from './context.svelte'
  import type { Snippet } from 'svelte'

  export interface LoadMoreSlotRender {
    page: number
    href: string | null
    load(): void
    onClick(e: MouseEvent): void
    loading: boolean
    action: 'load' | 'go'
    dir: 1 | -1
  }

  interface Props {
    dir: 1 | -1
    name?: string
    action?: 'auto' | 'load' | 'go'
    always?: boolean
    children: Snippet<[LoadMoreSlotRender]>
  }

  let { dir, name, action: actionProp = 'auto', always = false, children }: Props = $props()

  const state = usePaginatorState<unknown>(name)
  const options = usePaginatorOptions(name)
  const actions = usePaginatorActions(name)

  const action = $derived.by((): 'load' | 'go' => {
    if (actionProp && actionProp !== 'auto') return actionProp
    return options().mode === 'accumulate' ? 'load' : 'go'
  })

  const targetPage = $derived.by(() => {
    const s = state()
    if (action === 'go') return s.page + dir
    const loaded = s.loadedPages
    if (loaded.length === 0) return s.page + dir
    return dir === -1 ? Math.min(...loaded) - 1 : Math.max(...loaded) + 1
  })

  const hrefGetter = usePageHref(() => targetPage, name)
  const href = $derived(hrefGetter())

  const visible = $derived.by(() => {
    const o = options()
    const trig = dir === -1 ? o.topTrigger : o.bottomTrigger
    if (trig === 'off') return false
    if (action === 'load') {
      if (!always && trig !== 'manual') return false
      return canLoadMore(dir, state())
    }
    return canGo(dir, state())
  })

  const loading = $derived.by(() => {
    const p = state().pending
    return (
      !!p &&
      (action === 'go'
        ? p.mode === 'replace'
        : p.mode === (dir === -1 ? 'prepend' : 'append'))
    )
  })

  function load() {
    if (action === 'go') actions.goPage(targetPage)
    else actions.requestMore(dir)
  }

  function onClick(e: MouseEvent) {
    e.preventDefault()
    load()
  }
</script>

{#if visible}
  {@render children({
    page: targetPage,
    href,
    loading,
    action,
    dir,
    load,
    onClick,
  })}
{/if}
