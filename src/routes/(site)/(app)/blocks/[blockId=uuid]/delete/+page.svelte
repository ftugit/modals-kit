<script lang="ts">
  import BlocksDeletePage from '#sections/blocks/delete/BlocksDeletePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<BlocksDeletePage {data} />
