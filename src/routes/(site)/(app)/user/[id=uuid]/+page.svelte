<script lang="ts">
  import ProfileViewPage from '#sections/user/profile-view/ProfileViewPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<ProfileViewPage {data} />
