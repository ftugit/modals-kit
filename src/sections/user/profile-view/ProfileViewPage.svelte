<script lang="ts">
  // Страница профиля — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import Profile from '#modules/user/profile/svelte/Profile.svelte'
  import type { ProfileRouteData } from '#modules/user/profile/model/types.js'

  let { data }: { data: ProfileRouteData } = $props()
  const nickname = $derived(data.profile?.nickname ?? data.publicProfile?.nickname ?? null)

  useHeadSeo(() => ({
    subTitle: nickname ? `Профиль ${nickname}` : 'Профиль',
    description: 'Карточка профиля пользователя.',
    noindex: Boolean(data.fact || (!data.profile && !data.publicProfile)),
  }))
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else if data.publicProfile}
    <Profile uid={data.uid} initialPublic={data.publicProfile} variant="card" />
  {:else if !data.profile && !data.notCreated}
    <Acl model="not_found" backHref="/" />
  {:else}
    <Profile
      uid={data.uid}
      variant="card"
      initial={{
        profile: data.profile,
        isOwn: data.isOwn,
        visibility: data.visibility,
        notCreated: data.notCreated,
        canEdit: data.canEdit,
        canDeleteProfile: data.canDeleteProfile,
        canDeleteSeed: data.canDeleteSeed,
        fullBlock: data.fullBlock,
        blocks: data.blocks,
        canReadBlocks: data.canReadBlocks,
        canReadSessions: data.canReadSessions,
        canBlock: data.canBlock,
        canOpenConfig: data.canOpenConfig,
      }}
    />
  {/if}
</div>
