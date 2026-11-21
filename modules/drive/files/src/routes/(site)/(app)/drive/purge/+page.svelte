<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DrivePurge from '#modules/drive/ui/purge/DrivePurge.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DrivePurge initial={data} />
</DriveOperationPage>
