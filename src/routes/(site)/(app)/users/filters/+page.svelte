<script lang="ts">
  import UsersFiltersPage from '#sections/users/filters/UsersFiltersPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<UsersFiltersPage {data} />
