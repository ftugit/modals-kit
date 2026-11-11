<script lang="ts">
  import { untrack } from 'svelte'
  import { provideFilterBlocks, type FilterBlocksContext } from './filter-blocks.svelte.js'
  import { provideFilterList } from './filter-registry.svelte.js'
  let { capture }: { capture: (panel: FilterBlocksContext) => void } = $props()
  const panel = provideFilterBlocks(() => ({ schema: { source: 'probe', version: 1, fields: [] }, prefix: 'page' }))
  provideFilterList('probe')
  untrack(() => capture(panel))
</script>
