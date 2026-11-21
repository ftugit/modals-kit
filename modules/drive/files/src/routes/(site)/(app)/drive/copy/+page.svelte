<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveCopy from '#modules/drive/ui/copy/DriveCopy.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveCopy initial={data} />
</DriveOperationPage>
