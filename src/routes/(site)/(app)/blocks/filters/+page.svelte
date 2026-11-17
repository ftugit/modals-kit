<script lang="ts">
  import BlocksFiltersPage from '#sections/blocks/filters/BlocksFiltersPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<BlocksFiltersPage {data} />
