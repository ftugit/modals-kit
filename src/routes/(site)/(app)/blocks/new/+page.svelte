<script lang="ts">
  import BlocksNewPage from '#sections/blocks/new/BlocksNewPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<BlocksNewPage {data} />
