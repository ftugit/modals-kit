<script lang="ts">
  import BlocksEditPage from '#sections/blocks/edit/BlocksEditPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<BlocksEditPage {data} />
