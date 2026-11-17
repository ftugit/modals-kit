<script lang="ts">
  // Тонкий носитель: разметка и гейт — в `sections/storage-servers`.
  import StorageServersPage from '#sections/storage-servers/StorageServersPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<StorageServersPage {data} />
