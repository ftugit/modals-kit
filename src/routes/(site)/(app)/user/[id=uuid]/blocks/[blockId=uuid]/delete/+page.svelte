<script lang="ts">
  import UserBlocksDeletePage from '#sections/user/blocks-delete/UserBlocksDeletePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UserBlocksDeletePage {data} />
