<script lang="ts">
  import BlocksPage from '#sections/blocks/BlocksPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<BlocksPage {data} />
