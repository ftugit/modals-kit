<script lang="ts">
  import UserSessionsPage from '#sections/user/user-sessions/UserSessionsPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UserSessionsPage {data} />
