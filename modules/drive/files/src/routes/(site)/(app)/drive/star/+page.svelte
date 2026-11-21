<script lang="ts">
  import DriveOperationPage from '#modules/drive/ui/operation/DriveOperationPage.svelte'
  import DriveStar from '#modules/drive/ui/star/DriveStar.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveOperationPage {data}>
  <DriveStar initial={data} />
</DriveOperationPage>
