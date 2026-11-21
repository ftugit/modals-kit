<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveMkdir from '#modules/drive/ui/mkdir/DriveMkdir.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveMkdir initial={data} />
</DriveOperationPage>
