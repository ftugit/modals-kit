<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveShare from '#modules/drive/ui/share/DriveShare.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveShare initial={data} />
</DriveOperationPage>
