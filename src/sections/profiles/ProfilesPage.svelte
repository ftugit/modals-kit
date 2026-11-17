<script lang="ts">
  // Список профилей (`/profiles`) — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import ProfilesList from '#modules/user/profile/svelte/ProfilesList.svelte'
  import type { ProfilesRouteData } from '#modules/user/profile/svelte/profiles/source.js'

  let { data }: { data: ProfilesRouteData } = $props()

  useHeadSeo({
    subTitle: 'Профили',
    description: 'Список профилей пользователей.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <ProfilesList initial={data} variant="card" />
  {/if}
</div>
