<script lang="ts">
  import SessionCardPage from '#sections/user/session-card/SessionCardPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<SessionCardPage {data} />
