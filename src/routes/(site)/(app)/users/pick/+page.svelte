<script lang="ts">
  import UsersPickPage from '#sections/users/pick/UsersPickPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UsersPickPage {data} />
