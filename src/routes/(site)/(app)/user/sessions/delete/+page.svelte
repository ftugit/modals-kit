<script lang="ts">
  import SessionDeletePage from '#sections/user/session-delete/SessionDeletePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<SessionDeletePage {data} />
