<script lang="ts">
  import UsersDeletePage from '#sections/users/delete/UsersDeletePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UsersDeletePage {data} />
