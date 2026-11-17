<script lang="ts">
  import BlocksBulkPage from '#sections/blocks/bulk/BlocksBulkPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<BlocksBulkPage {data} />
