<script lang="ts">
  import ProfileDeletePage from '#sections/user/profile-delete/ProfileDeletePage.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<ProfileDeletePage {data} />
