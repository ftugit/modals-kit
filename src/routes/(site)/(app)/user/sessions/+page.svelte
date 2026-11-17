<script lang="ts">
  import SessionsPage from '#sections/user/sessions/SessionsPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<SessionsPage {data} />
