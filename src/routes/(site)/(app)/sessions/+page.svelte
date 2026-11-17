<script lang="ts">
  import SessionsPage from '#sections/sessions/SessionsPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<SessionsPage {data} />
