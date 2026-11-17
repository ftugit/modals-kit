<script lang="ts">
  import SessionDeleteTargetPage from '#sections/user/session-delete-target/SessionDeleteTargetPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<SessionDeleteTargetPage {data} />
