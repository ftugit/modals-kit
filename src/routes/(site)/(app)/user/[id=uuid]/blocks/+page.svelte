<script lang="ts">
  import UserBlocksPage from '#sections/user/blocks/UserBlocksPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UserBlocksPage {data} />
