<script lang="ts">
  import AuthPage from '#sections/user/auth/AuthPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<AuthPage {data} />
