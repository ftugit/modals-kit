<script lang="ts">
  import ConfigPage from '#sections/user/config/ConfigPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<ConfigPage {data} />
