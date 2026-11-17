<script lang="ts">
  import SessionsFiltersPage from '#sections/user/sessions-filters/SessionsFiltersPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<SessionsFiltersPage {data} />
