<script lang="ts">
  import AccountSessionPage from '#sections/user/account-session/AccountSessionPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<AccountSessionPage {data} />
