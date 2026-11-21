<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveDavRevoke from '#modules/drive/ui/dav-revoke/DriveDavRevoke.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveDavRevoke initial={data} />
</DriveOperationPage>
