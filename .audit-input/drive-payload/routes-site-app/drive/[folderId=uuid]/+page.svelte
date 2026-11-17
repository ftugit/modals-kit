<script lang="ts">
  import DrivePage from '#sections/drive/DrivePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<DrivePage {data} title={data.folder?.name ?? 'Папка'} />
