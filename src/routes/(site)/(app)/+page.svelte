<script lang="ts">
  import HomePage from '#sections/home/HomePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<HomePage {data} />
