<script lang="ts">
  import UserConfigPage from '#sections/user/user-config/UserConfigPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UserConfigPage {data} />
