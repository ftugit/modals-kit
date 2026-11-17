<script lang="ts">
  import UserBlocksEditPage from '#sections/user/blocks-edit/UserBlocksEditPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UserBlocksEditPage {data} />
