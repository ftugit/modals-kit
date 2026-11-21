<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveDavIssue from '#modules/drive/ui/dav-issue/DriveDavIssue.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveDavIssue initial={data} />
</DriveOperationPage>
