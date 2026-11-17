<script lang="ts">
  import UsersPage from '#sections/users/UsersPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UsersPage {data} />
