<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveUnshare from '#modules/drive/ui/unshare/DriveUnshare.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveUnshare initial={data} />
</DriveOperationPage>
