<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveTrashAction from '#modules/drive/ui/trash-action/DriveTrashAction.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveTrashAction initial={data} />
</DriveOperationPage>
