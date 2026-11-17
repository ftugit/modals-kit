<script lang="ts">
  import UserBlocksNewPage from '#sections/user/blocks-new/UserBlocksNewPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UserBlocksNewPage {data} />
