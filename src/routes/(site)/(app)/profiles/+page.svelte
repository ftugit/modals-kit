<script lang="ts">
  import ProfilesPage from '#sections/profiles/ProfilesPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<ProfilesPage {data} />
