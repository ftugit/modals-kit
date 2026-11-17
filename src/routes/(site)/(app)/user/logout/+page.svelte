<script lang="ts">
  import LogoutPage from '#sections/user/logout/LogoutPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<LogoutPage {data} />
