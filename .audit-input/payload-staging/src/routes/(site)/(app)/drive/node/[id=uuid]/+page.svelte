<script lang="ts">
  import DriveNodePage from '#sections/drive/DriveNodePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveNodePage {data} />
