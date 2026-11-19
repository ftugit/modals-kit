<script lang="ts">
  import DriveFiltersPage from '#sections/drive/filters/DriveFiltersPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DriveFiltersPage {data} />
