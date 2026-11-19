<script lang="ts">
  import DriveAccessPage from '#sections/drive/access/DriveAccessPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveAccessPage {data} />
