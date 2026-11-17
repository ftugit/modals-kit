<script lang="ts">
  import ProfileEditPage from '#sections/user/profile-edit/ProfileEditPage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<ProfileEditPage {data} />
